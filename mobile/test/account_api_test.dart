import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:notifai_mobile/data/account_api.dart';
import 'package:notifai_mobile/state/user_settings.dart';

const _id = '0123456789abcdef0123456789abcdef';
const _token = 'AbCdEfGhIjKlMnOpQrStUvWxYz-0123456789_AbCdE';
const _user = {'id': _id, 'username': 'account', 'displayName': 'account'};
const _apiBaseUrl = 'https://api.example.test/api';
const _webBaseUrl = 'https://app.example.test';

Matcher _error(String code) => throwsA(
  isA<AccountApiException>()
      .having((error) => error.code, 'code', code)
      .having((error) => error.toString(), 'safe message', code),
);

AccountApi _api({http.Client? client}) {
  final api = AccountApi(
    baseUrl: _apiBaseUrl,
    webBaseUrl: _webBaseUrl,
    client: client,
  );
  addTearDown(api.dispose);
  return api;
}

http.Response _json(Object? value, {int status = 200, String? etag}) =>
    http.Response.bytes(
      utf8.encode(jsonEncode(value)),
      status,
      headers: {'content-type': 'application/json', 'etag': ?etag},
    );

Map<String, dynamic> _snapshot(int revision, Object? settings) => {
  'schemaVersion': 1,
  'revision': revision,
  'settings': settings,
};

Map<String, dynamic> _settings() => {
  'subscriptionMode': 'custom',
  'subscribedDepts': ['招生办公室', '本科招生网'],
  'categoryMode': 'custom',
  'subscribedCategories': ['other', 'course_selection'],
  'blacklistKeywords': ['临时'],
  'starredIds': ['notice-1'],
  'starredFolderMap': {'notice-1': 'default'},
  'pinnedIds': ['notice-2'],
  'importantIds': ['notice-3'],
  'customTags': {
    'notice-1': ['研讨会'],
  },
  'folders': [
    {'id': 'default', 'name': '默认收藏', 'icon': r'$star', 'createdAt': 0},
  ],
};

class _StreamingClient extends http.BaseClient {
  _StreamingClient(this.respond);

  final Future<http.StreamedResponse> Function(http.BaseRequest) respond;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      respond(request);
}

void _serveJson(HttpResponse response, Object? value, {int status = 200}) {
  response.statusCode = status;
  response.headers.contentType = ContentType.json;
  response.add(utf8.encode(jsonEncode(value)));
}

void main() {
  test('only cloud fields are projected from local preferences', () {
    final preferences = UserPreferences.fromJson({
      ..._settings(),
      'schemaVersion': 3,
      'readIds': ['local-read'],
      'darkMode': 'dark',
      'notificationEnabled': true,
      'syncWriter': 'browser-only',
    });
    expect(projectCloudSettings(preferences), {
      ..._settings(),
      'subscribedDepts': ['本科招生网'],
      'subscribedCategories': ['course_selection', 'other'],
    });
  });

  test('native login, cookie scoping, logout and conditional writes', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    final calls = <String>[];
    final api = AccountApi(
      baseUrl: ' http://127.0.0.1:${server.port}/api/ ',
      webBaseUrl: ' HTTPS://APP.Example.Test:443/dashboard/ ',
    );
    addTearDown(api.dispose);
    final testPassword = 'test-only-credential';
    var revision = 0;
    Map<String, dynamic>? stored;
    server.listen((request) async {
      final response = request.response;
      final path = request.uri.path;
      final method = request.method;
      calls.add('$method $path');
      expect(request.headers.value('authorization'), isNull);
      expect(request.uri.hasQuery, isFalse);
      if (method == 'GET') {
        expect(request.headers.value('origin'), isNull);
      } else {
        expect(request.headers['origin'], ['https://app.example.test']);
      }
      if (path == '/api/auth/login' || path == '/api/auth/capabilities') {
        expect(request.headers.value('cookie'), isNull);
        expect(request.headers.value('x-notifai-account'), isNull);
      } else {
        expect(request.headers['cookie'], ['notifai_session=$_token']);
        expect(
          request.headers['x-notifai-account'],
          path == '/api/auth/session' ? isNull : [_id],
        );
      }

      switch ((method, path)) {
        case ('GET', '/api/auth/capabilities'):
          _serveJson(response, {
            'password': true,
            'ssoProviders': ['oidc'],
          });
        case ('POST', '/api/auth/login'):
          expect(request.headers.contentType?.mimeType, 'application/json');
          expect(jsonDecode(await utf8.decoder.bind(request).join()), {
            'username': 'account',
            'password': testPassword,
          });
          response.headers.add(
            'Set-Cookie',
            'other=ignore; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
          );
          response.headers.add(
            'Set-Cookie',
            'notifai_session=$_token; HttpOnly; Path=/api; Max-Age=604800',
          );
          response.headers.add(
            'Set-Cookie',
            'notifai_oidc_signup=ignore; HttpOnly; Path=/api/auth',
          );
          _serveJson(response, _user);
        case ('GET', '/api/auth/session'):
          _serveJson(response, _user);
        case ('GET', '/api/me/settings'):
          response.headers.set('ETag', '"$revision"');
          _serveJson(response, _snapshot(revision, stored));
        case ('PUT', '/api/me/settings'):
          final condition = request.headers['if-match']!;
          expect(condition, ['"0"']);
          final data =
              jsonDecode(await utf8.decoder.bind(request).join()) as Map;
          expect(data, {
            'schemaVersion': 1,
            'settings': projectCloudSettings(UserPreferences.defaults()),
          });
          if (condition.single != '"$revision"') {
            _serveJson(response, {'detail': 'REVISION_CONFLICT'}, status: 412);
          } else {
            revision++;
            stored = data['settings'] as Map<String, dynamic>;
            response.headers.set('ETag', '"$revision"');
            _serveJson(response, _snapshot(revision, stored));
          }
        case ('POST', '/api/auth/logout'):
          expect(await utf8.decoder.bind(request).join(), isEmpty);
          response.statusCode = 204;
          response.headers.add(
            'Set-Cookie',
            'notifai_session=; Max-Age=0; Path=/api',
          );
        default:
          fail('unexpected account request: $method $path');
      }
      await response.close();
    });

    final capabilities = await api.getCapabilities();
    expect(capabilities.hasPassword, isTrue);
    expect(capabilities.hasOidc, isTrue);
    final result = await api.login('account', testPassword);
    expect(result.token, _token);
    expect(result.user.id, _id);
    // A public request after login must still be sent without a Cookie header.
    expect((await api.getCapabilities()).hasOidc, isTrue);
    expect((await api.getSession(result.token))?.displayName, 'account');
    final empty = await api.getSettings(result.token, _id);
    expect(empty.revision, 0);
    expect(empty.settings, isNull);
    final local = UserPreferences.defaults().copyWith(
      readIds: ['local-read'],
      darkMode: 'dark',
      notificationEnabled: true,
    );
    final saved = await api.putSettings(
      result.token,
      _id,
      empty.revision,
      local,
    );
    expect(saved.revision, 1);
    expect(projectCloudSettings(saved.settings!), projectCloudSettings(local));
    expect(saved.settings!.readIds, isEmpty);
    expect(saved.settings!.darkMode, 'auto');
    expect(saved.settings!.notificationEnabled, isFalse);
    await expectLater(
      api.putSettings(result.token, _id, empty.revision, local),
      _error('REVISION_CONFLICT'),
    );
    expect((await api.getSettings(result.token, _id)).revision, 1);
    await api.logout(result.token, _id);
    expect(calls, [
      'GET /api/auth/capabilities',
      'POST /api/auth/login',
      'GET /api/auth/capabilities',
      'GET /api/auth/session',
      'GET /api/me/settings',
      'PUT /api/me/settings',
      'PUT /api/me/settings',
      'GET /api/me/settings',
      'POST /api/auth/logout',
    ]);
  });

  test(
    'real redirects never replay passwords, tokens or account headers',
    () async {
      final origin = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final other = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => origin.close(force: true));
      addTearDown(() => other.close(force: true));
      var originRequests = 0;
      var redirectedRequests = 0;
      other.listen((request) async {
        redirectedRequests++;
        await request.drain<void>();
        await request.response.close();
      });
      origin.listen((request) async {
        originRequests++;
        await request.drain<void>();
        request.response.statusCode = request.method == 'POST' ? 307 : 302;
        request.response.headers.set(
          'Location',
          'http://127.0.0.1:${other.port}/redirect',
        );
        await request.response.close();
      });
      final api = AccountApi(
        baseUrl: 'http://127.0.0.1:${origin.port}/api',
        webBaseUrl: 'http://[::1]:5173/',
      );
      addTearDown(api.dispose);
      await expectLater(
        api.login('account', 'test-only-credential'),
        _error('INVALID_RESPONSE'),
      );
      await expectLater(
        api.getSettings(_token, _id),
        _error('INVALID_RESPONSE'),
      );
      expect(originRequests, 2);
      expect(redirectedRequests, 0);
    },
  );

  test(
    'unsafe configuration and malformed credentials never reach the transport',
    () async {
      final transport = MockClient((_) async => fail('unexpected request'));
      addTearDown(transport.close);
      for (final url in [
        '/api',
        '//api.example.test/api',
        'http://api.example.test/api',
        'https://user:secret@api.example.test/api',
        'https://@api.example.test/api',
        'https://api.example.test:/api',
        'https://api.example.test:99999/api',
        'https://api.example.test/api?',
        'https://api.example.test/api#',
        r'https://api.example.test\evil/api',
      ]) {
        final api = AccountApi(
          baseUrl: url,
          webBaseUrl: _webBaseUrl,
          client: transport,
        );
        addTearDown(api.dispose);
        await expectLater(
          api.getCapabilities(),
          _error('CONFIGURATION'),
          reason: url,
        );
      }
      for (final url in [
        'http://app.example.test',
        'http://10.0.2.2:5173',
        'https://user@app.example.test',
        'https://app.example.test?query',
        'https://app.example.test#fragment',
      ]) {
        final api = AccountApi(
          baseUrl: _apiBaseUrl,
          webBaseUrl: url,
          client: transport,
        );
        addTearDown(api.dispose);
        await expectLater(
          api.login('account', 'test-only-credential'),
          _error('CONFIGURATION'),
          reason: url,
        );
      }
      final api = _api(client: transport);
      await expectLater(api.getSession('$_token\n'), _error('INVALID_INPUT'));
      await expectLater(
        api.logout(_token, '$_id\r\ninvalid'),
        _error('INVALID_INPUT'),
      );
      await expectLater(
        api.getSettings('a' * 44, _id),
        _error('INVALID_INPUT'),
      );
      await expectLater(
        api.putSettings(_token, _id, -1, UserPreferences.defaults()),
        _error('INVALID_INPUT'),
      );
    },
  );

  test('successful login needs exactly one opaque session value', () async {
    String? cookie;
    final transport = MockClient(
      (_) async => http.Response(
        jsonEncode(_user),
        200,
        headers: {'set-cookie': ?cookie},
      ),
    );
    addTearDown(transport.close);
    final api = _api(client: transport);
    for (final bad in [
      null,
      'other=$_token',
      'notifai_session=short; Path=/api',
      'notifai_session=$_token=; Path=/api',
      'notifai_session="$_token"; Path=/api',
      'notifai_session=$_token,notifai_session=$_token',
    ]) {
      cookie = bad;
      await expectLater(
        api.login('account', 'test-only-credential'),
        _error('INVALID_RESPONSE'),
      );
    }
  });

  test(
    'responses are decoded and validated without exposing raw data',
    () async {
      const secret = 'test-only-credential';
      var response = _json({'detail': 'AUTH_REQUIRED'}, status: 401);
      var throwTransportError = false;
      final transport = MockClient((_) async {
        if (throwTransportError) throw StateError(secret);
        return response;
      });
      addTearDown(transport.close);
      final api = _api(client: transport);
      expect(await api.getSession(_token), isNull);
      response = _json({'detail': 'INVALID_CREDENTIALS'}, status: 401);
      await expectLater(
        api.login('account', secret),
        _error('INVALID_CREDENTIALS'),
      );
      response = _json({'detail': 'ACCOUNT_CHANGED'}, status: 409);
      await expectLater(api.logout(_token, _id), _error('ACCOUNT_CHANGED'));
      for (final bad in [
        _json({'detail': 'AUTH_REQUIRED'}, status: 403),
        _json({'detail': secret}, status: 401),
        _json({'detail': 'AUTH_REQUIRED'}),
        http.Response('not valid JSON $secret', 200),
        http.Response.bytes([0xff], 200),
      ]) {
        response = bad;
        await expectLater(api.getSession(_token), _error('INVALID_RESPONSE'));
      }
      throwTransportError = true;
      await expectLater(api.login('account', secret), _error('NETWORK'));
    },
  );

  test('account identity and capability fields are validated', () async {
    var response = _json({
      ..._user,
      'username': null,
      'displayName': '😀' * 32,
    });
    final transport = MockClient((_) async => response);
    addTearDown(transport.close);
    final api = _api(client: transport);
    final ssoUser = await api.getSession(_token);
    expect(ssoUser!.username, isNull);
    expect(ssoUser.displayName, '😀' * 32);
    for (final value in [
      {..._user, 'id': _id.toUpperCase()},
      {..._user, 'username': 'UPPERCASE'},
      {..._user, 'displayName': '😀' * 33},
      {..._user, 'displayName': 'bad\u202ename'},
      {..._user, 'displayName': '\ufeffname'},
      {'id': _id, 'displayName': 'name'},
      {..._user, 'extra': 'unexpected'},
    ]) {
      response = _json(value);
      await expectLater(api.getSession(_token), _error('INVALID_RESPONSE'));
    }
    response = _json({
      'password': true,
      'ssoProviders': ['future-provider'],
    });
    expect((await api.getCapabilities()).hasOidc, isFalse);
    for (final value in [
      {'password': false, 'ssoProviders': []},
      {
        'password': true,
        'ssoProviders': [1],
      },
      {'password': true, 'ssoProviders': 'oidc'},
      {'password': true, 'ssoProviders': [], 'extra': true},
    ]) {
      response = _json(value);
      await expectLater(api.getCapabilities(), _error('INVALID_RESPONSE'));
    }
  });

  test(
    'ETag is canonical and revision matches the response and write',
    () async {
      var response = _json(
        _snapshot(9007199254740991, _settings()),
        etag: '"9007199254740991"',
      );
      final transport = MockClient((_) async => response);
      addTearDown(transport.close);
      final api = _api(client: transport);
      expect((await api.getSettings(_token, _id)).revision, 9007199254740991);
      for (final bad in [
        _json(_snapshot(0, null)),
        _json(_snapshot(0, null), etag: '0'),
        _json(_snapshot(0, null), etag: 'W/"0"'),
        _json(_snapshot(0, null), etag: '"00"'),
        _json(_snapshot(0, null), etag: '"0","0"'),
        _json(_snapshot(0, null), etag: '"1"'),
        _json(_snapshot(0, _settings()), etag: '"0"'),
        _json(_snapshot(1, null), etag: '"1"'),
        _json({..._snapshot(0, null), 'revision': 0.5}, etag: '"0"'),
        _json({..._snapshot(0, null), 'schemaVersion': 2}, etag: '"0"'),
        _json({..._snapshot(0, null), 'extra': true}, etag: '"0"'),
        _json(
          _snapshot(9007199254740992, _settings()),
          etag: '"9007199254740992"',
        ),
      ]) {
        response = bad;
        await expectLater(
          api.getSettings(_token, _id),
          _error('INVALID_RESPONSE'),
        );
      }
      response = _json(_snapshot(2, _settings()), etag: '"2"');
      await expectLater(
        api.putSettings(_token, _id, 0, UserPreferences.defaults()),
        _error('INVALID_RESPONSE'),
      );
      response = _json(_snapshot(1, _settings()), etag: '"1"');
      final echo = await api.putSettings(
        _token,
        _id,
        0,
        UserPreferences.defaults(),
      );
      expect(echo.settings?.subscribedDepts, ['本科招生网']);
    },
  );

  test(
    'cloud validation rejects malformed wire data before normalization',
    () async {
      var settings = _settings();
      final transport = MockClient(
        (_) async => _json(_snapshot(1, settings), etag: '"1"'),
      );
      addTearDown(transport.close);
      final api = _api(client: transport);
      settings['blacklistKeywords'] = ['😀' * 100, '\u0085allowed'];
      final valid = (await api.getSettings(_token, _id)).settings!;
      expect(valid.subscribedDepts, ['本科招生网']);
      expect(valid.subscribedCategories, ['course_selection', 'other']);
      expect(valid.blacklistKeywords, ['😀' * 100, '\u0085allowed']);

      for (final changes in <Map<String, dynamic>>[
        {'darkMode': 'dark'},
        {'subscribedDepts': []},
        {
          'subscribedCategories': ['unknown'],
        },
        {
          'subscribedCategories': ['course_selection', 'course_selection'],
        },
        {
          'blacklistKeywords': ['😀' * 101],
        },
        {
          'blacklistKeywords': ['\ud800'],
        },
        {
          'blacklistKeywords': ['\u00a0space'],
        },
        {
          'pinnedIds': ['x' * 129],
        },
        {
          'pinnedIds': ['notice-2', 'notice-2'],
        },
        {
          'pinnedIds': ['invalid.id'],
        },
        {
          'starredFolderMap': {'not-the-starred-id': 'default'},
        },
        {
          'starredFolderMap': {'notice-1': 'missing-folder'},
        },
        {
          'customTags': {'notice-1': []},
        },
        {
          'customTags': {
            'notice-1': ['😀' * 26],
          },
        },
        {'folders': []},
        {
          'folders': [
            {
              'id': 'not-default',
              'name': 'Folder',
              'icon': r'$star',
              'createdAt': 0,
            },
          ],
        },
        {
          'folders': [
            {
              'id': 'default',
              'name': 'Folder',
              'icon': 'mdi-star',
              'createdAt': 0,
            },
          ],
        },
        {
          'folders': [
            {
              'id': 'default',
              'name': 'Folder',
              'icon': r'$star',
              'createdAt': -1,
            },
          ],
        },
        {
          'folders': [
            {
              'id': 'default',
              'name': 'Folder',
              'icon': r'$star',
              'createdAt': 0,
              'extra': true,
            },
          ],
        },
      ]) {
        settings = {..._settings(), ...changes};
        await expectLater(
          api.getSettings(_token, _id),
          _error('INVALID_RESPONSE'),
          reason: changes.keys.join(','),
        );
      }
      settings = _settings()..remove('importantIds');
      await expectLater(
        api.getSettings(_token, _id),
        _error('INVALID_RESPONSE'),
      );
    },
  );

  test('declared and observed oversized bodies are rejected', () async {
    var declareLength = true;
    var cancelled = false;
    final transport = _StreamingClient((_) async {
      final stream = StreamController<List<int>>(
        onCancel: () {
          cancelled = true;
        },
      );
      if (!declareLength) stream.add(List<int>.filled(2 * 1024 * 1024 + 1, 0));
      return http.StreamedResponse(
        stream.stream,
        200,
        contentLength: declareLength ? 2 * 1024 * 1024 + 1 : null,
      );
    });
    addTearDown(transport.close);
    final api = _api(client: transport);
    await expectLater(api.getCapabilities(), _error('INVALID_RESPONSE'));
    expect(cancelled, isTrue);
    declareLength = false;
    cancelled = false;
    await expectLater(api.getCapabilities(), _error('INVALID_RESPONSE'));
    expect(cancelled, isTrue);
  });

  test('deadline includes reading the body and aborts the request', () async {
    final aborted = Completer<void>();
    final cancelled = Completer<void>();
    final transport = _StreamingClient((request) async {
      unawaited(
        (request as http.AbortableRequest).abortTrigger!.then(
          (_) => aborted.complete(),
        ),
      );
      final stream = StreamController<List<int>>(
        onCancel: () {
          cancelled.complete();
        },
      );
      return http.StreamedResponse(stream.stream, 200);
    });
    addTearDown(transport.close);
    final api = _api(client: transport);
    await expectLater(api.getCapabilities(), _error('NETWORK'));
    await Future.wait([aborted.future, cancelled.future]).timeout(
      const Duration(seconds: 1),
    );
  });
}
