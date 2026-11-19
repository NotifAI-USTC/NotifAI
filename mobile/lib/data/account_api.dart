import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../state/user_settings.dart';
import 'models.dart';

class AccountUser {
  const AccountUser({
    required this.id,
    required this.username,
    required this.displayName,
  });

  final String id;
  final String? username;
  final String displayName;
}

class AccountCapabilities {
  const AccountCapabilities({required this.hasOidc, this.hasPassword = true});

  final bool hasOidc;
  final bool hasPassword;
}

class CloudSnapshot {
  const CloudSnapshot({required this.revision, this.settings});

  final int revision;
  final UserPreferences? settings;
}

class AccountApiException implements Exception {
  const AccountApiException(this.code);

  final String code;

  @override
  String toString() => code;
}

const _invalidResponse = AccountApiException('INVALID_RESPONSE');
const _invalidInput = AccountApiException('INVALID_INPUT');
const _configuration = AccountApiException('CONFIGURATION');
const _network = AccountApiException('NETWORK');
const _maxRevision = 9007199254740991;
const _maxItems = 10000;
const _maxResponseBytes = 2 * 1024 * 1024;
const _deadline = Duration(seconds: 3);
const _cookie = 'notifai_session';
const _accountHeader = 'X-NotifAI-Account';
const _errorStatuses = {
  'INVALID_REVISION': 400,
  'AUTH_REQUIRED': 401,
  'INVALID_CREDENTIALS': 401,
  'SSO_SIGNUP_REQUIRED': 401,
  'ORIGIN_NOT_ALLOWED': 403,
  'ACCOUNTS_DISABLED': 404,
  'SSO_PROVIDER_UNAVAILABLE': 404,
  'ACCOUNT_CHANGED': 409,
  'SSO_ALREADY_REGISTERED': 409,
  'REVISION_EXHAUSTED': 409,
  'REVISION_CONFLICT': 412,
  'BODY_TOO_LARGE': 413,
  'UNSUPPORTED_MEDIA_TYPE': 415,
  'INVALID_INPUT': 422,
  'REVISION_REQUIRED': 428,
  'LOGIN_RATE_LIMITED': 429,
  'ACCOUNT_STORAGE_UNAVAILABLE': 503,
};

final _opaqueToken = RegExp(r'^[A-Za-z0-9_-]{43}$');
final _accountId = RegExp(r'^[a-f0-9]{32}$');
final _username = RegExp(r'^[a-z0-9][a-z0-9_.-]{2,31}$');
final _identifier = RegExp(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$');
final _urlAuthority = RegExp(
  r'^[a-zA-Z][a-zA-Z0-9+.-]*://(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:.]+\])(?::[0-9]+)?(?:/|$)',
);
final _unsafeUrlChar = RegExp(r'[\x00-\x20\x7f?#\\]');
const _loopbackHosts = {'localhost', '127.0.0.1', '::1', '[::1]'};

Uri _configuredUrl(String value, {bool web = false}) {
  final text = value.trim();
  if (_unsafeUrlChar.hasMatch(text) || !_urlAuthority.hasMatch(text)) {
    throw _configuration;
  }
  final uri = Uri.tryParse(text);
  final int port;
  try {
    port = uri?.port ?? 0;
  } on FormatException {
    throw _configuration;
  }
  if (uri == null ||
      !uri.hasAuthority ||
      uri.hasQuery ||
      uri.hasFragment ||
      port < 1 ||
      port > 65535 ||
      !(uri.authority.startsWith('[') || isValidHttpUri(uri))) {
    throw _configuration;
  }
  final local =
      _loopbackHosts.contains(uri.host) || (!web && uri.host == '10.0.2.2');
  if (uri.scheme != 'https' && !(kDebugMode && local && uri.scheme == 'http')) {
    throw _configuration;
  }
  return uri;
}

bool _matches(RegExp pattern, String value) =>
    pattern.matchAsPrefix(value)?.end == value.length;

void _checkCredentials(String token, [String? userId]) {
  if (!_matches(_opaqueToken, token) ||
      (userId != null && !_matches(_accountId, userId))) {
    throw _invalidInput;
  }
}

// IOClient flattens repeated Set-Cookie fields with commas. Do not split the
// comma inside an Expires date: only a comma followed by a cookie name starts
// another cookie. Never forward the original Set-Cookie header or attributes.
final _cookieBoundary = RegExp(r",(?=[ \t]*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)");

String _sessionToken(String? header) {
  String? token;
  for (final field in header?.split(_cookieBoundary) ?? const <String>[]) {
    final pair = field.trimLeft().split(';').first;
    if (!pair.startsWith('$_cookie=')) continue;
    final value = pair.substring(_cookie.length + 1);
    if (token != null || !_matches(_opaqueToken, value)) {
      throw _invalidResponse;
    }
    token = value;
  }
  return token ?? (throw _invalidResponse);
}

/// Account requests are bound to one validated API base. No token jar or
/// password is retained; callers explicitly pass the token to session routes.
class AccountApi {
  AccountApi({
    required this._baseUrl,
    required this._webBaseUrl,
    http.Client? client,
  }) : _client = client ?? http.Client(),
       _ownsClient = client == null;

  final String _baseUrl;
  final String _webBaseUrl;
  late final _base = _configuredUrl(_baseUrl)
      .toString()
      .replaceFirst(RegExp(r'/+$'), '');
  late final _webOrigin = _configuredUrl(_webBaseUrl, web: true).origin;
  final http.Client _client;
  final bool _ownsClient;
  bool _disposed = false;

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    if (_ownsClient) _client.close();
  }

  Future<AccountCapabilities> getCapabilities() async {
    final (value, _) = await _send('GET', '/auth/capabilities', 200);
    if (value is! Map<String, dynamic> ||
        !_exactKeys(value, const ['password', 'ssoProviders']) ||
        value['password'] != true) {
      throw _invalidResponse;
    }
    final providers = value['ssoProviders'];
    if (providers is! List || providers.any((item) => item is! String)) {
      throw _invalidResponse;
    }
    return AccountCapabilities(hasOidc: providers.contains('oidc'));
  }

  Future<AccountUser?> getSession(String token) async {
    _checkCredentials(token);
    try {
      final (value, _) = await _send('GET', '/auth/session', 200, token: token);
      return _parseUser(value);
    } on AccountApiException catch (error) {
      if (error.code == 'AUTH_REQUIRED') return null;
      rethrow;
    }
  }

  Future<({AccountUser user, String token})> login(
    String username,
    String password,
  ) async {
    final (value, headers) = await _send(
      'POST',
      '/auth/login',
      200,
      body: {'username': username, 'password': password},
    );
    return (
      user: _parseUser(value),
      token: _sessionToken(headers['set-cookie']),
    );
  }

  Future<void> logout(String token, String userId) async {
    _checkCredentials(token, userId);
    await _send('POST', '/auth/logout', 204, token: token, userId: userId);
  }

  Future<CloudSnapshot> getSettings(String token, String userId) async {
    _checkCredentials(token, userId);
    final (value, headers) = await _send(
      'GET',
      '/me/settings',
      200,
      token: token,
      userId: userId,
    );
    return _parseSnapshot(value, headers['etag']);
  }

  Future<CloudSnapshot> putSettings(
    String token,
    String userId,
    int revision,
    UserPreferences settings,
  ) async {
    _checkCredentials(token, userId);
    if (!_isRevision(revision)) throw _invalidInput;
    final projected = projectCloudSettings(settings);
    if (!_isCloudSettings(projected)) throw _invalidInput;
    final (value, headers) = await _send(
      'PUT',
      '/me/settings',
      200,
      token: token,
      userId: userId,
      // A response is accepted only with this exact canonical, quoted ETag.
      ifMatch: '"$revision"',
      body: {'schemaVersion': 1, 'settings': projected},
    );
    final snapshot = _parseSnapshot(value, headers['etag']);
    if (snapshot.revision != revision + 1) throw _invalidResponse;
    // The controller compares the normalized echo with its in-flight draft.
    return snapshot;
  }

  Future<(Object?, Map<String, String>)> _send(
    String method,
    String path,
    int expectedStatus, {
    String? token,
    String? userId,
    String? ifMatch,
    Map<String, dynamic>? body,
  }) async {
    if (_disposed) throw _network;
    // Account-only misconfiguration must not prevent app startup. Validate both
    // URLs before the transport can send even a read-only account request.
    final base = _base;
    final origin = _webOrigin;
    final abort = Completer<void>();
    StreamIterator<List<int>>? reader;
    Future<(http.StreamedResponse, Uint8List)?> transfer() async {
      final request = http.AbortableRequest(
        method,
        Uri.parse('$base$path'),
        abortTrigger: abort.future,
      )..followRedirects = false;
      request.headers['Accept'] = 'application/json';
      if (method != 'GET') request.headers['Origin'] = origin;
      if (token != null) request.headers['Cookie'] = '$_cookie=$token';
      if (userId != null) request.headers[_accountHeader] = userId;
      if (ifMatch != null) request.headers['If-Match'] = ifMatch;
      if (body != null) {
        request.headers['Content-Type'] = 'application/json; charset=utf-8';
        request.body = jsonEncode(body);
      }

      final response = await _client.send(request);
      if (abort.isCompleted ||
          (response.statusCode >= 300 && response.statusCode < 400) ||
          (response.contentLength ?? 0) > _maxResponseBytes) {
        // Also release a client that returns a stream after the deadline.
        final subscription = response.stream.listen(
          null,
          onError: (Object _) {},
        );
        await subscription.cancel();
        return null;
      }
      final iterator = reader = StreamIterator(response.stream);
      final bytes = BytesBuilder(copy: false);
      while (await iterator.moveNext()) {
        final chunk = iterator.current;
        if (chunk.length > _maxResponseBytes - bytes.length) return null;
        bytes.add(chunk);
      }
      return (response, bytes.takeBytes());
    }

    final (http.StreamedResponse, Uint8List)? result;
    try {
      result = await transfer().timeout(_deadline);
    } catch (_) {
      // Transport exceptions can contain request headers/body, including secrets.
      throw _network;
    } finally {
      abort.complete();
      final iterator = reader;
      if (iterator != null) {
        unawaited(iterator.cancel().then<void>((_) {}, onError: (Object _) {}));
      }
    }
    if (result == null) throw _invalidResponse;
    final (response, bytes) = result;
    if (response.statusCode == 204 && expectedStatus == 204) {
      if (bytes.isNotEmpty) throw _invalidResponse;
      return (null, response.headers);
    }

    final Object? value;
    try {
      value = jsonDecode(utf8.decode(bytes));
    } catch (_) {
      throw _invalidResponse;
    }
    if (response.statusCode != expectedStatus) {
      final code = value is Map<String, dynamic> ? value['detail'] : null;
      if (code is String && _errorStatuses[code] == response.statusCode) {
        throw AccountApiException(code);
      }
      throw _invalidResponse;
    }
    return (value, response.headers);
  }
}

bool _exactKeys(Map<String, dynamic> value, List<String> keys) =>
    value.length == keys.length && keys.every(value.containsKey);

// ECMAScript trim(), also used by the backend for settings and display names.
final _edgeWhitespace = RegExp(
  r'^[\x09-\x0d\x20\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]|[\x09-\x0d\x20\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]$',
);

bool _validDisplayName(String value) {
  if (value.isEmpty || _edgeWhitespace.hasMatch(value)) return false;
  var length = 0;
  for (final point in value.runes) {
    if (++length > 32 ||
        point <= 0x1f ||
        (point >= 0x7f && point <= 0x9f) ||
        point == 0x061c ||
        (point >= 0x200e && point <= 0x200f) ||
        (point >= 0x2028 && point <= 0x202e) ||
        (point >= 0x2066 && point <= 0x2069) ||
        (point >= 0xd800 && point <= 0xdfff)) {
      return false;
    }
  }
  return true;
}

AccountUser _parseUser(Object? value) {
  if (value is! Map<String, dynamic> ||
      !_exactKeys(value, const ['id', 'username', 'displayName'])) {
    throw _invalidResponse;
  }
  final id = value['id'];
  final username = value['username'];
  final displayName = value['displayName'];
  if (id is! String ||
      !_matches(_accountId, id) ||
      (username != null &&
          (username is! String || !_matches(_username, username))) ||
      displayName is! String ||
      !_validDisplayName(displayName)) {
    throw _invalidResponse;
  }
  return AccountUser(
    id: id,
    username: username as String?,
    displayName: displayName,
  );
}

bool _isRevision(Object? value) =>
    value is int && value >= 0 && value <= _maxRevision;

CloudSnapshot _parseSnapshot(Object? value, String? etag) {
  if (value is! Map<String, dynamic> ||
      !_exactKeys(value, const ['schemaVersion', 'revision', 'settings']) ||
      value['schemaVersion'] is! int ||
      value['schemaVersion'] != 1) {
    throw _invalidResponse;
  }
  final revision = value['revision'];
  final settings = value['settings'];
  if (revision is! int ||
      !_isRevision(revision) ||
      etag != '"$revision"' ||
      (revision == 0) != (settings == null)) {
    throw _invalidResponse;
  }
  if (settings == null) return const CloudSnapshot(revision: 0);
  if (settings is! Map<String, dynamic> || !_isCloudSettings(settings)) {
    throw _invalidResponse;
  }
  return CloudSnapshot(
    revision: revision,
    settings: _normalizedPreferences(settings),
  );
}

const _cloudFields = [
  'subscriptionMode',
  'subscribedDepts',
  'categoryMode',
  'subscribedCategories',
  'blacklistKeywords',
  'starredIds',
  'starredFolderMap',
  'pinnedIds',
  'importantIds',
  'customTags',
  'folders',
];

/// Includes only fields in the cloud contract, never device preferences or
/// backup metadata. [preferences] is the app's normalized local model.
Map<String, dynamic> projectCloudSettings(UserPreferences preferences) => {
  'subscriptionMode': preferences.subscriptionMode,
  'subscribedDepts': preferences.subscribedDepts,
  'categoryMode': preferences.categoryMode,
  'subscribedCategories': preferences.subscribedCategories,
  'blacklistKeywords': preferences.blacklistKeywords,
  'starredIds': preferences.starredIds,
  'starredFolderMap': preferences.starredFolderMap,
  'pinnedIds': preferences.pinnedIds,
  'importantIds': preferences.importantIds,
  'customTags': preferences.customTags,
  'folders': preferences.folders.map((folder) => folder.toJson()).toList(),
};

bool _isText(Object? value, int limit) =>
    value is String &&
    value.isNotEmpty &&
    value.length <= limit &&
    !_edgeWhitespace.hasMatch(value) &&
    !value.runes.any((point) => point >= 0xd800 && point <= 0xdfff);

bool _isId(Object? value) => value is String && _matches(_identifier, value);

bool _validList(
  Object? value,
  bool Function(Object?) valid, {
  int limit = _maxItems,
  int minimum = 0,
}) {
  if (value is! List || value.length < minimum || value.length > limit) {
    return false;
  }
  final seen = <Object?>{};
  return value.every((item) => valid(item) && seen.add(item));
}

bool _validMode(Object? mode, Object? choices) =>
    mode == 'all' ||
    (mode == 'custom' && choices is List && choices.isNotEmpty);

const _folderIcons = {
  r'$star',
  r'$school',
  r'$trophy',
  r'$flask',
  r'$domain',
  r'$folder',
};

bool _isCloudSettings(Map<String, dynamic> value) {
  if (!_exactKeys(value, _cloudFields) ||
      !_validMode(value['subscriptionMode'], value['subscribedDepts']) ||
      !_validMode(value['categoryMode'], value['subscribedCategories']) ||
      !_validList(value['subscribedDepts'], (item) => _isText(item, 200)) ||
      !_validList(
        value['subscribedCategories'],
        categoryNames.containsKey,
        limit: categoryNames.length,
      ) ||
      !_validList(value['blacklistKeywords'], (item) => _isText(item, 200)) ||
      !_validList(value['starredIds'], _isId) ||
      !_validList(value['pinnedIds'], _isId) ||
      !_validList(value['importantIds'], _isId)) {
    return false;
  }
  final folders = value['folders'];
  if (folders is! List || folders.isEmpty || folders.length > 100) return false;
  final folderIds = <Object?>{};
  for (final folder in folders) {
    if (folder is! Map<String, dynamic> ||
        !_exactKeys(folder, const ['id', 'name', 'icon', 'createdAt']) ||
        !_isId(folder['id']) ||
        !folderIds.add(folder['id']) ||
        !_isText(folder['name'], 100) ||
        !_folderIcons.contains(folder['icon']) ||
        !_isRevision(folder['createdAt'])) {
      return false;
    }
  }
  final starred = value['starredIds'] as List;
  final folderMap = value['starredFolderMap'];
  if (!folderIds.contains('default') ||
      folderMap is! Map<String, dynamic> ||
      folderMap.length != starred.length ||
      starred.any((id) => !folderIds.contains(folderMap[id]))) {
    return false;
  }
  final tags = value['customTags'];
  return tags is Map<String, dynamic> &&
      tags.length <= _maxItems &&
      tags.entries.every(
        (entry) =>
            _isId(entry.key) &&
            _validList(
              entry.value,
              (tag) => _isText(tag, 50),
              limit: 50,
              minimum: 1,
            ),
      );
}

UserPreferences _normalizedPreferences(Map<String, dynamic> settings) {
  // Validate before normalizing; a tolerant local backup import would otherwise
  // silently repair malformed server data. Preserve valid Web whitespace and
  // use the same source aliases and category order as the local model.
  final starredIds = (settings['starredIds'] as List).cast<String>();
  final folderMap = settings['starredFolderMap'] as Map;
  final categories = (settings['subscribedCategories'] as List).toSet();
  return UserPreferences.defaults().copyWith(
    subscriptionMode: settings['subscriptionMode'] as String,
    subscribedDepts: (settings['subscribedDepts'] as List)
        .cast<String>()
        .map(normalizeSource)
        .toSet()
        .toList(),
    categoryMode: settings['categoryMode'] as String,
    subscribedCategories: categoryNames.keys
        .where(categories.contains)
        .toList(),
    blacklistKeywords: (settings['blacklistKeywords'] as List).cast<String>(),
    starredIds: starredIds,
    starredFolderMap: {
      for (final id in starredIds) id: folderMap[id] as String,
    },
    pinnedIds: (settings['pinnedIds'] as List).cast<String>(),
    importantIds: (settings['importantIds'] as List).cast<String>(),
    customTags: (settings['customTags'] as Map<String, dynamic>).map(
      (id, tags) => MapEntry(id, (tags as List).cast<String>()),
    ),
    folders: (settings['folders'] as List)
        .map(
          (folder) => NoticeFolder(
            id: folder['id'] as String,
            name: folder['name'] as String,
            icon: folder['icon'] as String,
            createdAt: folder['createdAt'] as int,
          ),
        )
        .toList(),
  );
}
