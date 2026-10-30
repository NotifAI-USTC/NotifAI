import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/services/ics.dart';

String unfold(String value) => value.replaceAll('\r\n ', '');

void main() {
  test(
    'exports only inclusive visible dates and uses exclusive all-day DTEND',
    () {
      final result = unfold(
        buildCalendarIcs(
          const [
            CalendarEntry(
              id: 'before',
              title: '跨月',
              source: '教务处',
              publishDate: '2026-09-30',
              deadline: '2026-10-01',
            ),
            CalendarEntry(
              id: 'last',
              title: '月底',
              source: '教务处',
              publishDate: '2026-10-31',
              deadline: '2026-11-01',
            ),
            CalendarEntry(
              id: 'outside',
              title: '范围外',
              source: '教务处',
              publishDate: '2026-11-02',
            ),
          ],
          rangeStart: '2026-10-01',
          rangeEnd: '2026-10-31',
          generatedAt: DateTime.utc(2026, 9, 30, 23, 59, 1),
        ),
      );
      expect(RegExp('BEGIN:VEVENT').allMatches(result), hasLength(2));
      expect(
        result,
        contains('DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261002'),
      );
      expect(
        result,
        contains('DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101'),
      );
      expect(result, contains('DTSTAMP:20260930T235901Z'));
      expect(result, isNot(contains('20260930\r\n')));
      expect(result, isNot(contains('UID:outside')));
    },
  );

  test('same-day publication and deadline export one all-day event', () {
    const entry = CalendarEntry(
      id: 'same',
      title: '当日截止',
      source: '学院',
      publishDate: '2026-10-30',
      deadline: '2026-10-30',
    );
    final result = unfold(
      buildCalendarIcs(
        const [entry, entry],
        rangeStart: '2026-10-30',
        rangeEnd: '2026-10-30',
      ),
    );
    expect(RegExp('BEGIN:VEVENT').allMatches(result), hasLength(1));
    expect(
      result,
      contains('DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031'),
    );
  });

  test('escapes injection, folds UTF-8 octets and emits CRLF only', () {
    final title = '${List.filled(80, '通知').join()}\\,;\r\nBEGIN:VEVENT';
    final result = buildCalendarIcs(
      [
        CalendarEntry(
          id: 'escaped',
          title: title,
          source: '教务处',
          publishDate: '2026-10-30',
        ),
      ],
      rangeStart: '2026-10-01',
      rangeEnd: '2026-10-31',
    );
    final unfolded = unfold(result);
    expect(unfolded, contains(r'\\\,\;\nBEGIN:VEVENT'));
    expect(unfolded, contains(r'DESCRIPTION:来源: 教务处\n发布日期: 2026-10-30'));
    expect(
      unfolded.split('\r\n').where((line) => line == 'BEGIN:VEVENT'),
      hasLength(1),
    );
    for (final line in result.split('\r\n')) {
      expect(utf8.encode(line).length, lessThanOrEqualTo(75));
    }
    expect(result.replaceAll('\r\n', ''), isNot(contains('\n')));
    expect(result.endsWith('END:VCALENDAR\r\n'), isTrue);
  });

  test('rejects reversed ranges and preserves leap-day date boundaries', () {
    expect(
      () => buildCalendarIcs(
        const [],
        rangeStart: '2026-11-01',
        rangeEnd: '2026-10-01',
      ),
      throwsFormatException,
    );
    final result = unfold(
      buildCalendarIcs(
        const [
          CalendarEntry(
            id: 'leap',
            title: '闰日',
            source: '学院',
            publishDate: '2028-02-29',
          ),
        ],
        rangeStart: '2028-02-29',
        rangeEnd: '2028-02-29',
      ),
    );
    expect(
      result,
      contains('DTSTART;VALUE=DATE:20280229\r\nDTEND;VALUE=DATE:20280301'),
    );
  });
}
