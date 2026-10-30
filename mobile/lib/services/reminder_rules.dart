import '../data/models.dart';

const maxReminderPlans = 60;
const reminderHorizon = Duration(days: 60);

class ReminderPlan {
  const ReminderPlan({
    required this.id,
    required this.title,
    required this.when,
    required this.deadline,
    required this.notificationId,
  });

  final String id;
  final String title;
  final DateTime when;
  final String deadline;
  final int notificationId;

  factory ReminderPlan.fromJson(Object? value) {
    if (value is! Map ||
        !isValidNoticeId(value['id']) ||
        value['title'] is! String ||
        (value['title'] as String).isEmpty ||
        value['deadline'] is! String ||
        value['when'] is! String ||
        value['notificationId'] is! int ||
        (value['notificationId'] as int) < 100 ||
        (value['notificationId'] as int) > 2147483646) {
      throw const FormatException('本地提醒计划格式损坏');
    }
    final rawWhen = value['when'] as String;
    final when = DateTime.tryParse(rawWhen);
    if (when == null ||
        !rawWhen.endsWith('Z') ||
        when.toUtc().toIso8601String() != rawWhen) {
      throw const FormatException('本地提醒时间无效');
    }
    final deadline = value['deadline'] as String;
    parseDateOnly(deadline);
    return ReminderPlan(
      id: value['id'] as String,
      title: value['title'] as String,
      when: when.toLocal(),
      deadline: deadline,
      notificationId: value['notificationId'] as int,
    );
  }

  Map<String, Object> toJson() => {
    'id': id,
    'title': title,
    'when': when.toUtc().toIso8601String(),
    'deadline': deadline,
    'notificationId': notificationId,
  };
}

/// Null means the time is eligible. Date-only deadlines end at local midnight
/// following that date, regardless of UTC offset or daylight-saving changes.
String? reminderTimeRejection({
  required String? deadline,
  required DateTime when,
  required DateTime now,
}) {
  if (deadline == null) return '该通知没有已知截止日期，不能安排截止提醒';
  DateTime date;
  try {
    date = parseDateOnly(deadline);
  } on DataValidationException {
    return '通知截止日期无效';
  }
  if (!when.isAfter(now)) return '提醒时间必须晚于当前时间';
  if (when.isAfter(now.add(reminderHorizon))) return '仅支持安排未来 60 天内的本地提醒';
  final end = DateTime(date.year, date.month, date.day + 1);
  if (!when.isBefore(end)) return '提醒时间不能晚于截止日期';
  return null;
}

/// This decision needs neither cached notice data nor a network request, so
/// broken detail storage cannot prevent a privacy or permission cancellation.
bool shouldKeepLocalReminder(
  ReminderPlan plan, {
  required bool notificationEnabled,
  required bool permissionGranted,
  required Set<String> importantIds,
  required DateTime now,
}) =>
    notificationEnabled &&
    permissionGranted &&
    importantIds.contains(plan.id) &&
    reminderTimeRejection(deadline: plan.deadline, when: plan.when, now: now) ==
        null;

bool shouldKeepReminder(
  ReminderPlan plan, {
  required bool notificationEnabled,
  required Set<String> importantIds,
  required String? currentDeadline,
  required DateTime now,
}) =>
    shouldKeepLocalReminder(
      plan,
      notificationEnabled: notificationEnabled,
      permissionGranted: true,
      importantIds: importantIds,
      now: now,
    ) &&
    currentDeadline == plan.deadline;
