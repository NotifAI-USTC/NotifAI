import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../data/account_api.dart';
import 'user_settings.dart';

enum AccountStatus {
  guest,
  checking,
  unavailable,
  loading,
  synced,
  saving,
  dirty,
  conflict,
}

typedef AccountSession = ({String userId, String token});

class AccountController extends ChangeNotifier {
  AccountController({
    required this._api,
    required this._settings,
    required this._readSession,
    required this._writeSession,
    required this._openWeb,
  }) {
    _settings.addListener(_settingsChanged);
  }

  final AccountApi _api;
  final UserSettings _settings;
  final Future<AccountSession?> Function() _readSession;
  final Future<void> Function(AccountSession?) _writeSession;
  final Future<void> Function() _openWeb;

  AccountSession? _session;
  AccountUser? _user;
  AccountStatus _status = AccountStatus.guest;
  Timer? _timer;
  bool _busy = false;
  bool _sending = false;
  bool _disposed = false;
  bool _applyingCloud = false;
  int _revision = 0;
  String _baseline = '';
  ({UserPreferences value, String key})? _draft;
  UserPreferences? _importCandidate;
  CloudSnapshot? _conflict;
  String? _notice;

  AccountUser? get user => _user;
  AccountStatus get status => _status;
  bool get busy => _busy || _sending;
  bool get hasImportCandidate =>
      _settings.profileReady &&
      _importCandidate != null &&
      _revision == 0 &&
      _draft == null;
  bool get canOverwrite =>
      _conflict != null && status == AccountStatus.conflict;
  bool get hasUnsynced => _draft != null;
  String? get notice => _notice;

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  String _key(UserPreferences value) => jsonEncode(projectCloudSettings(value));

  void _rememberGuestPreferences() {
    if (_settings.accountMode || _settings.readOnly) return;
    final candidate = _settings.value;
    if (_key(candidate) != _key(UserPreferences.defaults())) {
      _importCandidate = candidate;
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (busy || _disposed) throw const AccountApiException('ACCOUNT_CHANGED');
    _busy = true;
    _emit();
    try {
      await action();
    } finally {
      _busy = false;
      _emit();
      if (_status == AccountStatus.saving) unawaited(_flush());
    }
  }

  Future<AccountCapabilities> getCapabilities() => _api.getCapabilities();
  Future<void> openWebAccount() => _openWeb();

  /// Only local secure storage gates bootstrap; remote checks run independently
  /// of the public notice feed. Never show guest preferences for a saved login.
  Future<void> initialize() async {
    try {
      _session = await _readSession();
    } catch (_) {
      _notice = '无法读取本机会话，当前使用游客偏好。请重试账号服务。';
      _status = AccountStatus.unavailable;
      _emit();
      return;
    }
    if (_disposed || _session == null) return;
    _rememberGuestPreferences();
    _status = AccountStatus.checking;
    await _settings.switchProfile(account: true);
    if (!_disposed) unawaited(restore());
  }

  Future<void> restore() => _run(() async {
    if (_settings.profileReady && _user != null) return;
    _notice = null;
    try {
      final session = _session ??= await _readSession();
      if (_disposed) return;
      if (session == null) {
        _status = AccountStatus.guest;
        return;
      }
      _status = AccountStatus.checking;
      if (!_settings.accountMode) {
        _rememberGuestPreferences();
        await _settings.switchProfile(account: true);
      }
      _emit();
      final current = await _api.getSession(session.token);
      if (_disposed) return;
      if (current == null || current.id != session.userId) {
        await _retire('登录已失效，请重新登录。');
        return;
      }
      _user = current;
      if (current.username == null) _importCandidate = null;
      await _loadCloud(session);
    } catch (_) {
      if (_disposed) return;
      _status = AccountStatus.unavailable;
      _notice = _settings.accountMode
          ? '暂时无法验证会话或加载账号偏好。公告仍可浏览；账号偏好未启用。'
          : '无法读取本机会话，当前使用游客偏好。请重试账号服务。';
    }
  });

  Future<void> signIn(String username, String password) => _run(() async {
    if (_settings.accountMode || _session != null) {
      throw const AccountApiException('ACCOUNT_CHANGED');
    }
    final result = await _api.login(username, password);
    if (_disposed) return;
    _rememberGuestPreferences();
    final session = (userId: result.user.id, token: result.token);
    _session = session;
    _user = result.user;
    _notice = null;
    _status = AccountStatus.loading;
    await _settings.switchProfile(account: true);
    try {
      await _writeSession(session);
    } catch (_) {
      _notice = '会话未能保存到系统安全存储，重启后可能需要重新登录。';
    }
    if (_disposed) return;
    try {
      await _loadCloud(session);
    } catch (_) {
      if (_disposed) return;
      _status = AccountStatus.unavailable;
      _notice = '已登录，但暂时无法加载账号偏好。公告仍可浏览，请重试。';
    }
  });

  Future<void> _loadCloud(AccountSession session) async {
    _status = AccountStatus.loading;
    _emit();
    try {
      final snapshot = await _api.getSettings(session.token, session.userId);
      if (_disposed) return;
      _accept(snapshot);
      await _settings.switchProfile(
        account: true,
        accountId: session.userId,
        cloud: snapshot.settings,
      );
    } on AccountApiException catch (error) {
      if (!_disposed && !await _identityFailure(error)) rethrow;
    }
  }

  void _accept(CloudSnapshot snapshot) {
    _revision = snapshot.revision;
    _baseline = _key(snapshot.settings ?? UserPreferences.defaults());
    if (_revision != 0) _importCandidate = null;
    _conflict = null;
    _draft = null;
    _status = AccountStatus.synced;
  }

  Future<void> signOut() => _run(() async {
    final session = _session;
    if (session == null) return;
    try {
      await _api.logout(session.token, session.userId);
    } on AccountApiException catch (error) {
      if (error.code != 'AUTH_REQUIRED' && error.code != 'ACCOUNT_CHANGED') {
        rethrow;
      }
    }
    if (!_disposed) await _retire(null);
  });

  Future<bool> _identityFailure(AccountApiException error) async {
    if (error.code != 'AUTH_REQUIRED' && error.code != 'ACCOUNT_CHANGED') {
      return false;
    }
    await _retire(hasUnsynced ? '登录已失效，未同步的账号偏好已丢弃。' : '登录已失效，请重新登录。');
    return true;
  }

  Future<void> _retire(String? notice) async {
    _timer?.cancel();
    _timer = null;
    _session = null;
    _user = null;
    _revision = 0;
    _baseline = '';
    _draft = null;
    _conflict = null;
    _importCandidate = null;
    _notice = notice;
    _status = AccountStatus.guest;
    try {
      await _writeSession(null);
    } catch (_) {
      _notice = '无法清除系统安全存储中的会话，请检查设备存储。';
    }
    if (!_disposed) {
      await _settings.switchProfile(account: false);
      _emit();
    }
  }

  Future<void> checkSession() async {
    final session = _session;
    if (_disposed ||
        session == null ||
        _user == null ||
        busy ||
        !_settings.profileReady) {
      return;
    }
    _busy = true;
    try {
      final current = await _api.getSession(session.token);
      if (!_disposed && current?.id != session.userId) {
        await _identityFailure(const AccountApiException('AUTH_REQUIRED'));
      }
    } on AccountApiException {
      // Going offline must not discard a draft or switch to guest preferences.
    } finally {
      _busy = false;
      _emit();
      if (_status == AccountStatus.saving) unawaited(_flush());
    }
  }

  void _settingsChanged() {
    if (_disposed ||
        _applyingCloud ||
        _session == null ||
        !_settings.profileReady ||
        _settings.accountId != _session?.userId) {
      return;
    }
    final value = _settings.value;
    final key = _key(value);
    if (key == _draft?.key) return;
    final stopped =
        _status == AccountStatus.dirty || _status == AccountStatus.conflict;
    if (!_sending && !stopped && key == _baseline) {
      if (_draft == null) return;
      _timer?.cancel();
      _timer = null;
      _draft = null;
      _status = AccountStatus.synced;
    } else {
      _draft = (value: value, key: key);
      if (!stopped) {
        _status = AccountStatus.saving;
        _timer?.cancel();
        _timer = Timer(const Duration(milliseconds: 300), () {
          _timer = null;
          unawaited(_flush());
        });
      }
    }
    _emit();
  }

  Future<void> _flush() async {
    final pending = _draft;
    final session = _session;
    if (_disposed ||
        busy ||
        _timer != null ||
        pending == null ||
        session == null ||
        _status != AccountStatus.saving) {
      return;
    }
    _sending = true;
    _emit();
    try {
      final result = await _api.putSettings(
        session.token,
        session.userId,
        _revision,
        pending.value,
      );
      if (_disposed) return;
      if (result.settings == null || _key(result.settings!) != pending.key) {
        throw const AccountApiException('INVALID_RESPONSE');
      }
      _revision = result.revision;
      _baseline = pending.key;
      _importCandidate = null;
      _conflict = null;
      if (_draft?.key == pending.key) {
        _timer?.cancel();
        _timer = null;
        _draft = null;
        _status = AccountStatus.synced;
      }
    } on AccountApiException catch (error) {
      if (_disposed || await _identityFailure(error)) return;
      _timer?.cancel();
      _timer = null;
      if (error.code == 'REVISION_CONFLICT') {
        _status = AccountStatus.conflict;
        _conflict = null;
        _emit();
        await _readConflict(session);
      } else {
        _status = AccountStatus.dirty;
        _conflict = null;
      }
    } catch (_) {
      _timer?.cancel();
      _timer = null;
      _status = AccountStatus.dirty;
      _conflict = null;
    } finally {
      _sending = false;
      _emit();
      if (_status == AccountStatus.saving) unawaited(_flush());
    }
  }

  Future<void> importLocal() async {
    final candidate = _importCandidate;
    if (candidate == null || !hasImportCandidate) return;
    await _run(() => _settings.replaceCloud(candidate));
    _timer?.cancel();
    _timer = null;
    await _flush();
  }

  Future<void> retrySave() async {
    if (busy || _status != AccountStatus.dirty) return;
    _status = AccountStatus.saving;
    await _flush();
  }

  Future<void> _readConflict(AccountSession session) async {
    try {
      final snapshot = await _api.getSettings(session.token, session.userId);
      if (!_disposed) _conflict = snapshot;
    } on AccountApiException catch (error) {
      if (!_disposed) {
        _conflict = null;
        await _identityFailure(error);
      }
    }
  }

  Future<void> refreshConflict() => _run(() async {
    final session = _session;
    if (_status == AccountStatus.conflict && session != null) {
      await _readConflict(session);
    }
  });

  Future<void> useCloudVersion() => _run(() async {
    final session = _session;
    if (_status != AccountStatus.conflict || session == null) return;
    final expected = _settings.value;
    CloudSnapshot snapshot;
    try {
      snapshot = await _api.getSettings(session.token, session.userId);
    } on AccountApiException catch (error) {
      if (!_disposed && !await _identityFailure(error)) rethrow;
      return;
    }
    if (_disposed) return;
    _applyingCloud = true;
    try {
      await _settings.replaceCloud(snapshot.settings, expected: expected);
      _importCandidate = null;
      _accept(snapshot);
    } finally {
      _applyingCloud = false;
      _settingsChanged();
    }
  });

  Future<void> overwriteCloud() async {
    if (busy || !canOverwrite) return;
    _revision = _conflict!.revision;
    // Compare subsequent edits against the actual known server version.
    _baseline = _key(_conflict!.settings ?? UserPreferences.defaults());
    _status = AccountStatus.saving;
    await _flush();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _settings.removeListener(_settingsChanged);
    _api.dispose();
    super.dispose();
  }
}
