import 'dart:convert';

import '../data/models.dart';

String _escape(String value) => value
    .replaceAll('\\', '\\\\')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .replaceAll('\n', r'\n')
    .replaceAll(';', r'\;')
    .replaceAll(',', r'\,');

// RFC 5545 folds by UTF-8 octets, never in the middle of a code point.
String _fold(String line) {
  final chunks = <String>[];
  var current = StringBuffer();
  var octets = 0;
  for (final rune in line.runes) {
    final character = String.fromCharCode(rune);
    final length = utf8.encode(character).length;
    if (octets + length > 75) {
      chunks.add(current.toString());
      current = StringBuffer(' ');
      octets = 1;
    }
    current.write(character);
    octets += length;
  }
  chunks.add(current.toString());
  return chunks.join('\r\n');
}

/// Both boundaries are inclusive local calendar dates, not UTC instants.
String buildCalendarIcs(
  List<CalendarEntry> entries, {
  required String rangeStart,
  required String rangeEnd,
  DateTime? generatedAt,
}) {
  final start = parseDateOnly(rangeStart);
  final end = parseDateOnly(rangeEnd);
  if (end.isBefore(start)) {
    throw const FormatException('导出日历的结束日期早于开始日期');
  }
  final stamp =
      '${(generatedAt ?? DateTime.now()).toUtc().toIso8601String().replaceAll('-', '').replaceAll(':', '').split('.').first}Z';
  final lines = <String>[
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NotifAI//USTC Notices//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  final emitted = <String>{};
  for (final entry in entries) {
    final dates = <(String, String)>[
      ('publish', entry.publishDate),
      if (entry.deadline != null && entry.deadline != entry.publishDate)
        ('deadline', entry.deadline!),
    ];
    for (final (kind, value) in dates) {
      final date = parseDateOnly(value);
      if (date.isBefore(start) || date.isAfter(end)) continue;
      final uid = '${entry.id}-$kind-$value@notifai';
      if (!emitted.add(uid)) continue;
      // Construct the following civil date instead of adding 24 hours across DST.
      final nextDate = DateTime(date.year, date.month, date.day + 1);
      final deadline = kind == 'deadline';
      lines.addAll([
        'BEGIN:VEVENT',
        'UID:${_escape(uid)}',
        'DTSTAMP:$stamp',
        'DTSTART;VALUE=DATE:${value.replaceAll('-', '')}',
        'DTEND;VALUE=DATE:${dateOnly(nextDate).replaceAll('-', '')}',
        'SUMMARY:${_escape('${deadline ? '截止' : '发布'} · ${entry.title}')}',
        'DESCRIPTION:${_escape('来源: ${entry.source}\n${deadline ? '截止日期' : '发布日期'}: $value')}',
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ]);
    }
  }
  lines.add('END:VCALENDAR');
  return '${lines.map(_fold).join('\r\n')}\r\n';
}
