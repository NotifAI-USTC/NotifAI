import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/services/reminder_rules.dart';

void main() {
  final now = DateTime(2026, 10, 30, 9);
  ReminderPlan plan({String deadline = '2026-10-31', DateTime? when}) =>
      ReminderPlan(
        id: 'notice_1',
        title: '报名截止',
        deadline: deadline,
        when: when ?? DateTime(2026, 10, 31, 18),
        notificationId: 100,
      );

  test('known deadline, future time and finite horizon are all required', () {
    String? rejection(String? deadline, DateTime when) =>
        reminderTimeRejection(deadline: deadline, when: when, now: now);
    expect(rejection(null, now.add(const Duration(hours: 1))), isNotNull);
    expect(
      rejection('2026-02-30', now.add(const Duration(hours: 1))),
      isNotNull,
    );
    expect(rejection('2026-10-31', now), isNotNull);
    expect(
      rejection('2026-10-31', now.subtract(const Duration(seconds: 1))),
      isNotNull,
    );
    expect(rejection('2026-12-31', now.add(reminderHorizon)), isNull);
    expect(
      rejection(
        '2026-12-31',
        now.add(reminderHorizon).add(const Duration(microseconds: 1)),
      ),
      isNotNull,
    );
    expect(maxReminderPlans, 60);
  });

  test(
    'deadline includes the whole local civil day, but not following midnight',
    () {
      expect(
        reminderTimeRejection(
          deadline: '2026-10-31',
          now: now,
          when: DateTime(2026, 10, 31, 23, 59, 59, 999),
        ),
        isNull,
      );
      expect(
        reminderTimeRejection(
          deadline: '2026-10-31',
          now: now,
          when: DateTime(2026, 11, 1),
        ),
        isNotNull,
      );
      expect(
        reminderTimeRejection(
          deadline: '2026-10-29',
          now: now,
          when: now.add(const Duration(hours: 1)),
        ),
        isNotNull,
      );
    },
  );

  test('disable, remove important, remove or change deadline and elapsed time invalidate plans', () {
    final original = plan();
    bool keep({
      bool enabled = true,
      Set<String> important = const {'notice_1'},
      String? currentDeadline = '2026-10-31',
      DateTime? clock,
    }) => shouldKeepReminder(
      original,
      notificationEnabled: enabled,
      importantIds: important,
      currentDeadline: currentDeadline,
      now: clock ?? now,
    );
    expect(keep(), isTrue);
    expect(keep(enabled: false), isFalse);
    expect(keep(important: {}), isFalse);
    expect(keep(currentDeadline: null), isFalse);
    expect(keep(currentDeadline: '2026-11-01'), isFalse);
    expect(keep(clock: original.when), isFalse);
  });

  test('local opt-out, revoked permission and removed importance need no usable date data', () {
    final corrupt = plan(deadline: 'damaged-date');
    bool keep(
      ReminderPlan candidate, {
      bool enabled = true,
      bool permission = true,
      Set<String> important = const {'notice_1'},
      DateTime? clock,
    }) => shouldKeepLocalReminder(
      candidate,
      notificationEnabled: enabled,
      permissionGranted: permission,
      importantIds: important,
      now: clock ?? now,
    );
    expect(keep(plan()), isTrue);
    expect(keep(plan(), permission: false), isFalse);
    expect(keep(corrupt, enabled: false), isFalse);
    expect(keep(corrupt, permission: false), isFalse);
    expect(keep(corrupt, important: {}), isFalse);
    expect(keep(corrupt), isFalse);
    final expired = plan(when: now);
    expect(keep(expired), isFalse);
  });

  test(
    'persisted plans round-trip their instant, deadline and stable native ID',
    () {
      final original = plan(when: DateTime.parse('2026-10-31T18:30:00+08:00'));
      final json = original.toJson();
      expect(json['when'], '2026-10-31T10:30:00.000Z');
      final restored = ReminderPlan.fromJson(json);
      expect(restored.when.isAtSameMomentAs(original.when), isTrue);
      expect(restored.id, original.id);
      expect(restored.deadline, original.deadline);
      expect(restored.notificationId, original.notificationId);
      expect(restored.toJson(), json);
    },
  );

  test('corrupt persisted times, identifiers and test-notification ID are rejected', () {
    final valid = plan().toJson();
    for (final change in <String, Object>{
      'id': '../detail',
      'when': '2026-10-31T18:00:00',
      'notificationId': 1,
      'deadline': '2026-02-30',
    }.entries) {
      expect(
        () => ReminderPlan.fromJson({...valid, change.key: change.value}),
        throwsException,
      );
    }
    expect(
      () =>
          ReminderPlan.fromJson({...valid, 'when': '2026-02-30T18:00:00.000Z'}),
      throwsFormatException,
    );
  });
}
