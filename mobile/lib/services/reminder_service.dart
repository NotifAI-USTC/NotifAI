import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest.dart' as timezone_data;
import 'package:timezone/timezone.dart' as tz;

import '../data/local_store.dart';
import '../data/models.dart';
import '../data/notice_repository.dart';
import '../state/user_settings.dart';
import 'reminder_rules.dart';

export 'reminder_rules.dart' show ReminderPlan;

class ReminderException implements Exception {
  const ReminderException(this.message);
  final String message;
  @override
  String toString() => message;
}

class ReminderService extends ChangeNotifier {
  ReminderService(this._store, this._repository, this._settings);

  final LocalStore _store;
  final NoticeRepository _repository;
  final UserSettings _settings;
  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  final ValueNotifier<String?> openedNotice = ValueNotifier(null);
  static const _storageKey = 'reminders.v1';
  static const _details = NotificationDetails(
    android: AndroidNotificationDetails(
      'notifai_deadlines',
      '截止日期提醒',
      channelDescription: '你为已知截止日期设置的本设备提醒，不是后台新通知推送',
      importance: Importance.high,
      priority: Priority.high,
      icon: 'ic_stat_notifai',
    ),
    iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true),
  );

  final List<ReminderPlan> _plans = [];
  Future<void> _tail = Future<void>.value();
  bool _ready = false;
  bool _listening = false;
  bool _disposed = false;
  bool _permissionGranted = false;
  String? _lastError;
  bool? _observedEnabled;
  List<String> _observedImportant = const [];
  int? _observedProfileVersion;
  String? _loadedKey;
  bool _profileLoaded = false;

  String? get _requestedKey {
    if (!_settings.profileReady) return null;
    final id = _settings.accountId;
    return id == null ? _storageKey : '$_storageKey:account:$id';
  }

  String? get _error => _lastError;
  set _error(String? value) {
    if (_lastError == value) return;
    _lastError = value;
    _emit();
  }

  void _emit() {
    if (!_disposed) notifyListeners();
  }

  bool get supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
  bool get permissionGranted => _permissionGranted;
  String? get error => _error;
  List<ReminderPlan> get plans => _loadedKey == _requestedKey
      ? List.unmodifiable(_plans)
      : const [];

  Future<T> _serial<T>(Future<T> Function() action) {
    final result = _tail.then((_) async {
      if (_disposed) throw const ReminderException('提醒服务已关闭');
      try {
        return await action();
      } catch (error) {
        _error = error.toString();
        rethrow;
      }
    });
    // One failed operation must not poison later cancellations or retries.
    _tail = result.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return result;
  }

  Future<void> initialize() => _serial(() async {
    if (_ready) return;
    if (!supported) {
      _error = '本地定时提醒仅支持 Android 和 iOS';
      return;
    }
    timezone_data.initializeTimeZones();
    await _updateTimezone();
    final initialized = await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('ic_stat_notifai'),
        iOS: DarwinInitializationSettings(
          requestAlertPermission: false,
          requestBadgePermission: false,
          requestSoundPermission: false,
        ),
      ),
      onDidReceiveNotificationResponse: (response) =>
          _openPayload(response.payload),
    );
    if (initialized != true) throw const ReminderException('本地通知插件初始化失败');
    _ready = true;
    final launch = await _plugin.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true) {
      // Keep this value until the root navigator has mounted and consumed it.
      _openPayload(launch?.notificationResponse?.payload);
    }
    _observeSettings();
    _settings.addListener(_settingsChanged);
    _listening = true;
    unawaited(reconcile());
  });

  void _openPayload(String? payload) {
    if (!_disposed && payload != null && isValidNoticeId(payload)) {
      openedNotice.value = payload;
    }
  }

  void _observeSettings() {
    _observedEnabled = _settings.value.notificationEnabled;
    _observedImportant = _settings.value.importantIds;
    _observedProfileVersion = _settings.profileVersion;
  }

  void _settingsChanged() {
    final preferences = _settings.value;
    if (_observedProfileVersion == _settings.profileVersion &&
        _observedEnabled == preferences.notificationEnabled &&
        listEquals(_observedImportant, preferences.importantIds)) {
      return;
    }
    _observeSettings();
    // reconcile contains its own background error reporting; a settings save
    // never becomes an unhandled asynchronous platform exception.
    unawaited(reconcile());
  }

  Future<void> _activateProfile() async {
    final key = _requestedKey;
    if (_profileLoaded && key == _loadedKey) return;
    // There is only one active OS schedule. Preserve inactive profiles on
    // disk, but never reconcile their plans against another profile's marks.
    if (_profileLoaded || key == null) {
      final failures = <String>[];
      await _clearUnexpectedSystemPlans({}, failures);
      if (failures.isNotEmpty) throw ReminderException(failures.join('\n'));
    }
    _profileLoaded = false;
    _loadedKey = null;
    _plans.clear();
    _emit();
    if (key != null) {
      final raw = await _store.read(key);
      if (key != _requestedKey) return;
      if (raw != null) {
        if (raw is! Map || raw['version'] != 1 || raw['plans'] is! List ||
            (raw['plans'] as List).length > maxReminderPlans) {
          throw const ReminderException('本地提醒记录格式不兼容，已保留原始记录');
        }
        final ids = <String>{};
        final systemIds = <int>{};
        final restored = <ReminderPlan>[];
        for (final item in raw['plans'] as List) {
          final plan = ReminderPlan.fromJson(item);
          if (!ids.add(plan.id) || !systemIds.add(plan.notificationId)) {
            throw const ReminderException('本地提醒记录包含重复编号，已保留原始记录');
          }
          restored.add(plan);
        }
        _plans.addAll(restored);
      }
    }
    _loadedKey = key;
    _profileLoaded = true;
    _emit();
  }

  Future<void> _forProfile(Future<void> Function() action) {
    final version = _settings.profileVersion;
    return _serial(() async {
      _requireReady();
      if (version != _settings.profileVersion || !_settings.profileReady) {
        throw const ReminderException('账号偏好尚未加载或已切换，请重试');
      }
      await _activateProfile();
      if (version != _settings.profileVersion || _loadedKey == null) {
        throw const ReminderException('账号已切换，请重试');
      }
      await action();
    });
  }

  void _requireReady() {
    if (!supported) throw const ReminderException('此设备不支持本地定时提醒');
    if (!_ready) throw ReminderException(_error ?? '本地提醒尚未初始化，请重新启动应用');
  }

  Future<void> _updateTimezone() async {
    final device = await FlutterTimezone.getLocalTimezone();
    tz.setLocalLocation(tz.getLocation(device.identifier));
  }

  Future<bool> _readPermission() async {
    final previous = _permissionGranted;
    if (defaultTargetPlatform == TargetPlatform.android) {
      _permissionGranted =
          await _plugin
              .resolvePlatformSpecificImplementation<
                AndroidFlutterLocalNotificationsPlugin
              >()!
              .areNotificationsEnabled() ==
          true;
    } else {
      final status = await _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >()!
          .checkPermissions();
      _permissionGranted = status?.isEnabled == true;
    }
    if (previous != _permissionGranted) _emit();
    return _permissionGranted;
  }

  Future<bool> requestPermission() => _serial(() async {
    _requireReady();
    if (defaultTargetPlatform == TargetPlatform.android) {
      await _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()!
          .requestNotificationsPermission();
    } else {
      await _plugin
          .resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin
          >()!
          .requestPermissions(alert: true, sound: true, badge: true);
    }
    final granted = await _readPermission();
    _error = granted ? null : await _cancelRevokedPermissionPlans();
    return granted;
  });

  Future<void> _requirePermission() async {
    if (!await _readPermission()) {
      throw ReminderException(await _cancelRevokedPermissionPlans());
    }
  }

  Future<void> _scheduleSystem(ReminderPlan plan) async {
    await _plugin.zonedSchedule(
      id: plan.notificationId,
      title: plan.title,
      body: '截止日期：${plan.deadline}。点击查看通知详情。',
      scheduledDate: tz.TZDateTime.from(plan.when, tz.local),
      notificationDetails: _details,
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      payload: plan.id,
    );
    final pending = await _plugin.pendingNotificationRequests();
    if (!pending.any(
      (item) => item.id == plan.notificationId && item.payload == plan.id,
    )) {
      throw const ReminderException('系统未保留提醒计划，请检查通知权限和设备限制');
    }
  }

  Future<void> _persist(List<ReminderPlan> next) async {
    await _store.write(_loadedKey!, {
      'version': 1,
      'plans': next.map((plan) => plan.toJson()).toList(),
    });
    _plans
      ..clear()
      ..addAll(next);
    _plans.sort((a, b) => a.when.compareTo(b.when));
    _emit();
  }

  int _allocateId() {
    final used = _plans.map((plan) => plan.notificationId).toSet();
    for (var id = 100; id <= 100 + maxReminderPlans; id++) {
      if (!used.contains(id)) return id;
    }
    throw const ReminderException('本地提醒编号已用尽');
  }

  Future<void> schedule(Notice notice, DateTime when) => _forProfile(() async {
    if (!_settings.value.notificationEnabled) {
      throw const ReminderException('请先在“我的”中启用本地通知提醒');
    }
    if (!_settings.value.importantIds.contains(notice.id)) {
      throw const ReminderException('请先将该通知标记为重要');
    }
    final rejection = reminderTimeRejection(
      deadline: notice.deadline,
      when: when,
      now: DateTime.now(),
    );
    if (rejection != null) throw ReminderException(rejection);
    final previous = _plans.where((plan) => plan.id == notice.id).firstOrNull;
    if (previous == null && _plans.length >= maxReminderPlans) {
      throw const ReminderException('最多保留 60 个近期提醒，请先取消其他提醒');
    }
    await _requirePermission();
    await _updateTimezone();
    final plan = ReminderPlan(
      id: notice.id,
      title: notice.title,
      when: when,
      deadline: notice.deadline!,
      notificationId: previous?.notificationId ?? _allocateId(),
    );
    try {
      await _scheduleSystem(plan);
      await _persist([..._plans.where((item) => item.id != notice.id), plan]);
    } catch (failure) {
      // Commit to SQLite only after the OS accepts scheduling. If persistence
      // fails, restore the old OS state instead of claiming the new plan saved.
      try {
        if (previous == null) {
          await _plugin.cancel(id: plan.notificationId);
        } else {
          await _scheduleSystem(previous);
        }
      } catch (rollback) {
        throw ReminderException(
          '提醒未保存：$failure；恢复系统计划失败：$rollback。请重新打开应用以核对计划',
        );
      }
      rethrow;
    }
    _error = null;
  });

  Future<void> _cancelPlan(
    ReminderPlan plan, {
    bool restoreOnFailure = true,
  }) async {
    await _plugin.cancel(id: plan.notificationId);
    try {
      await _persist(_plans.where((item) => item.id != plan.id).toList());
    } catch (failure) {
      try {
        if (restoreOnFailure && plan.when.isAfter(DateTime.now())) {
          await _scheduleSystem(plan);
        }
      } catch (rollback) {
        throw ReminderException('取消提醒未保存：$failure；恢复系统计划失败：$rollback');
      }
      rethrow;
    }
  }

  Future<void> cancel(String noticeId) => _forProfile(() async {
    final plan = _plans.where((item) => item.id == noticeId).firstOrNull;
    if (plan != null) await _cancelPlan(plan);
    _error = null;
  });

  /// Safe for resume / settings listeners. Failures remain visible via [error],
  /// while explicit user scheduling, cancellation and tests throw to their UI.
  Future<void> reconcile() async {
    if (_disposed || !supported || !_ready) return;
    try {
      await _serial(_reconcile);
    } catch (failure) {
      _error = failure.toString();
    }
  }

  Future<void> _clearUnexpectedSystemPlans(
    Set<int> expected,
    List<String> failures,
  ) async {
    try {
      final pending = await _plugin.pendingNotificationRequests();
      for (final request in pending) {
        if (request.id < 100 || expected.contains(request.id)) continue;
        try {
          await _plugin.cancel(id: request.id);
        } catch (failure) {
          failures.add('取消系统提醒 ${request.id} 失败：$failure');
        }
      }
    } catch (failure) {
      failures.add('读取系统提醒列表失败：$failure');
    }
  }

  Future<String> _cancelRevokedPermissionPlans() async {
    final failures = <String>[];
    for (final plan in List<ReminderPlan>.of(_plans)) {
      try {
        // A revoked permission is never rolled back into a live OS schedule,
        // even if removing its persisted record fails.
        await _cancelPlan(plan, restoreOnFailure: false);
      } catch (failure) {
        failures.add('取消“${plan.title}”失败：$failure');
      }
    }
    await _clearUnexpectedSystemPlans({}, failures);
    return ['系统通知权限未获准，请在设备设置中允许 NotifAI 发送通知', ...failures].join('\n');
  }

  Future<void> _reconcile() async {
    await _activateProfile();
    final key = _loadedKey;
    bool active() => key != null && key == _requestedKey;
    if (!active()) return;
    final failures = <String>[];
    final blocked = <String>{};
    bool locallyEligible(ReminderPlan plan) => shouldKeepLocalReminder(
      plan,
      notificationEnabled: _settings.value.notificationEnabled,
      permissionGranted: true,
      importantIds: _settings.value.importantIds.toSet(),
      now: DateTime.now(),
    );
    Future<void> discard(ReminderPlan plan) async {
      if (!active()) return;
      blocked.add(plan.id);
      try {
        // Invalid plans must stay cancelled even if SQLite removal fails. Keep
        // the record and an explicit error for retry, not a restored OS alarm.
        await _cancelPlan(plan, restoreOnFailure: false);
      } catch (failure) {
        failures.add('取消“${plan.title}”失败：$failure');
      }
    }

    // No cache or permission-channel read may prevent local opt-out, removal
    // from important, expiration, or an already invalid deadline cancellation.
    for (final plan in List<ReminderPlan>.of(_plans)) {
      if (!locallyEligible(plan)) await discard(plan);
    }
    bool? permitted;
    try {
      permitted = await _readPermission();
    } catch (failure) {
      failures.add('读取系统通知权限失败，未重新安排提醒：$failure');
    }
    if (!active()) return;
    if (permitted == false) {
      failures.add(await _cancelRevokedPermissionPlans());
      _error = failures.join('\n');
      return;
    }

    for (final plan in List<ReminderPlan>.of(_plans)) {
      if (blocked.contains(plan.id)) continue;
      if (!locallyEligible(plan)) {
        await discard(plan);
        continue;
      }
      try {
        final cached = await _repository.cachedDetail(plan.id);
        if (!active()) return;
        if (cached != null && cached.value.deadline != plan.deadline) {
          await discard(plan);
        }
      } catch (failure) {
        // A corrupt item is visible, but cannot block other cancellations or
        // the authoritative network check for this and other notice IDs.
        failures.add('读取“${plan.title}”缓存失败，将继续在线核对：$failure');
      }
    }
    final candidates = _plans
        .where((plan) => !blocked.contains(plan.id))
        .toList();
    if (candidates.isNotEmpty) {
      List<Notice>? latest;
      try {
        latest = await _repository.batch(
          candidates.map((plan) => plan.id).toList(),
          light: true,
        );
      } catch (failure) {
        failures.add('未能核对最新截止日期，保留已有有效提醒：$failure');
      }
      if (!active()) return;
      if (latest != null) {
        final byId = {for (final notice in latest) notice.id: notice};
        for (final plan in candidates) {
          if (!locallyEligible(plan) ||
              byId[plan.id]?.deadline != plan.deadline) {
            await discard(plan);
          }
        }
      }
    }
    // Settings and permissions can change while the network request is in
    // flight. Re-check both before restoring any scheduled notifications.
    for (final plan in List<ReminderPlan>.of(_plans)) {
      if (!blocked.contains(plan.id) && !locallyEligible(plan)) {
        await discard(plan);
      }
    }
    if (permitted == true) {
      try {
        permitted = await _readPermission();
      } catch (failure) {
        permitted = null;
        failures.add('再次核对系统通知权限失败，未重新安排提醒：$failure');
      }
      if (!active()) return;
      if (permitted == false) {
        failures.add(await _cancelRevokedPermissionPlans());
        _error = failures.join('\n');
        return;
      }
    }
    if (!active()) return;
    final retained = _plans
        .where((plan) => !blocked.contains(plan.id))
        .toList();
    await _clearUnexpectedSystemPlans(
      retained.map((plan) => plan.notificationId).toSet(),
      failures,
    );
    if (permitted == true && retained.isNotEmpty) {
      var timezoneReady = false;
      try {
        await _updateTimezone();
        timezoneReady = true;
      } catch (failure) {
        failures.add('读取设备时区失败，未重新安排提醒：$failure');
      }
      if (timezoneReady) {
        for (final plan in retained) {
          if (!active()) return;
          if (!locallyEligible(plan)) {
            await discard(plan);
            continue;
          }
          try {
            await _scheduleSystem(plan);
          } catch (failure) {
            failures.add('安排“${plan.title}”失败：$failure');
          }
        }
      }
    }
    _error = failures.isEmpty ? null : failures.join('\n');
  }

  Future<void> sendTest() => _forProfile(() async {
    if (!_settings.value.notificationEnabled) {
      throw const ReminderException('请先启用本地通知提醒');
    }
    await _requirePermission();
    await _plugin.show(
      id: 1,
      title: 'NotifAI 测试提醒',
      body: '本设备通知通道已调用。这不是新通知后台推送；实际显示仍受系统勿扰和省电策略影响。',
      notificationDetails: _details,
    );
    _error = null;
  });

  @override
  void dispose() {
    if (_listening) _settings.removeListener(_settingsChanged);
    _disposed = true;
    openedNotice.dispose();
    super.dispose();
  }
}
