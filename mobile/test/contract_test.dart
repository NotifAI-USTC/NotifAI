import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/app.dart' show defaultWebBase;
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/services/platform_actions.dart';
import 'package:notifai_mobile/state/user_settings.dart';

// Fixed fixtures mirror backend contracts. Update this file together with the
// corresponding backend contract so mobile regressions surface in CI.
Map<String, dynamic> noticeFixture({
  Object? publishDate = '2026-11-08',
  Object? originUrl = '',
}) => {
  'id': 'contract-notice',
  'title': '契约通知',
  'source': '计算机科学与技术学院',
  'categories': ['course_selection'],
  'contentType': 'notice',
  'publishDate': publishDate,
  'deadline': '2026-11-12',
  'originUrl': originUrl,
  'cleanContent': '正文',
  'attachments': <Object?>[],
  'firstSeen': '2026-11-07T16:30:00Z',
  'lastCrawl': '2026-11-08T01:00:00.000Z',
};

void main() {
  test('空发布日期与空原文地址不丢通知，抓取时间保留 UTC 字符串', () {
    final notice = Notice.fromJson(noticeFixture(publishDate: null));
    expect(notice.publishDate, isNull);
    expect(publishDateLabel(notice.publishDate), '未知');
    expect(notice.originUrl, '');
    expect(notice.source, '计算机学院');
    expect(notice.firstSeen, '2026-11-07T16:30:00Z');
    expect(notice.lastCrawl, '2026-11-08T01:00:00.000Z');
    final legacy = Notice.fromJson({
      ...noticeFixture(),
      'lastCrawl': '2026-11-07T16:30:00',
    });
    expect(legacy.lastCrawl, '2026-11-07T16:30:00');
  });

  test('旧缓存中的空字符串发布日期按 null 兼容', () {
    final notice = Notice.fromJson(noticeFixture(publishDate: ''));
    expect(notice.publishDate, isNull);
    expect(notice.toJson()['publishDate'], isNull);
  });

  test('ustclug HTTPS 原文地址被接受，非 HTTPS 与外部域名仍拒绝', () {
    final notice = Notice.fromJson(
      noticeFixture(originUrl: 'https://servers.ustclug.org/files/notice.pdf'),
    );
    expect(notice.originUrl, contains('servers.ustclug.org'));
    expect(Notice.fromJson(noticeFixture(originUrl: null)).originUrl, isEmpty);
    expect(
      Notice.fromJson(
        noticeFixture(originUrl: 'https://www.ustc.edu.cn/notice'),
      ).originUrl,
      contains('www.ustc.edu.cn'),
    );
    expect(
      () => Notice.fromJson(
        noticeFixture(originUrl: 'http://servers.ustclug.org/notice'),
      ),
      throwsA(isA<DataValidationException>()),
    );
    expect(
      () => Notice.fromJson(
        noticeFixture(originUrl: 'https://example.org/notice'),
      ),
      throwsA(isA<DataValidationException>()),
    );
  });

  test('旧来源别名在设置、目录与查询中归一且去重', () {
    expect(normalizeSource('计算机科学与技术学院'), '计算机学院');
    expect(normalizeSource('招生办公室'), '本科招生网');
    expect(normalizeSource('国际合作与交流部'), '国际合作交流');
    final preferences = UserPreferences.fromJson({
      'subscribedDepts': ['招生办公室', '本科招生网', '国际合作与交流部'],
    });
    expect(preferences.subscribedDepts, ['本科招生网', '国际合作交流']);
    expect(
      SourceItem.fromJson({'name': '招生办公室', 'group': '招生', 'noticeCount': 1})
          .name,
      '本科招生网',
    );
    final parameters = NoticeQuery(
      source: '国际合作与交流部',
      sources: const ['招生办公室'],
    ).toParameters();
    expect(parameters['source'], '国际合作交流');
    expect(parameters['sources[]'], ['本科招生网']);
  });

  test('分享文本对空发布日期显示未知', () {
    final actions = PlatformActions(webBaseUrl: defaultWebBase);
    final text = actions.shareText(
      Notice.fromJson(noticeFixture(publishDate: null)),
    );
    expect(text, contains('【发布时间】未知'));
  });

  test('light batch 空正文仍可解析为通知摘要', () {
    final notice = Notice.fromJson({
      ...noticeFixture(publishDate: null),
      'cleanContent': '',
    });
    expect(notice.cleanContent, '');
    expect(notice.title, '契约通知');
  });

  test('日历保留 total/truncated，旧响应缺少字段时兼容', () {
    final current = CalendarResult.fromJson({
      'items': [
        {
          'id': 'contract-notice',
          'title': '契约通知',
          'source': '计算机科学与技术学院',
          'publishDate': null,
          'deadline': '2026-11-12',
          'contentType': 'notice',
        },
      ],
      'total': 501,
      'truncated': true,
    });
    expect(current.entries.single.publishDate, isNull);
    expect(current.total, 501);
    expect(current.truncated, isTrue);

    final legacy = CalendarResult.fromJson({
      'items': [
        {
          'id': 'contract-notice',
          'title': '契约通知',
          'source': '计算机科学与技术学院',
          'publishDate': '2026-11-08',
        },
      ],
    });
    expect(legacy.total, 1);
    expect(legacy.truncated, isFalse);
  });
}
