import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/data/notice_repository.dart';
import 'package:notifai_mobile/state/notice_feed.dart';
import 'package:notifai_mobile/state/user_settings.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  late LocalStore store;
  late UserSettings settings;
  late HttpServer server;
  late NoticeRepository repository;
  NoticeFeed? feed;
  late Future<void> Function(HttpRequest) handle;
  Notice notice(String id, String title) => Notice(
    id: id,
    title: title,
    source: '教务处',
    publishDate: '2026-10-30',
    originUrl: 'https://ustc.edu.cn/$id',
  );
  void respond(
    HttpRequest request,
    List<Notice> items,
    int total, {
    int status = 200,
  }) {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(
      jsonEncode({
        'items': items.map((n) => n.toJson()).toList(),
        'total': total,
        'nextCursor': null,
      }),
    );
    unawaited(request.response.close());
  }

  setUp(() async {
    sqfliteFfiInit();
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = UserSettings(store);
    await settings.initialize();
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) => unawaited(handle(request)));
    repository = NoticeRepository(
      store: store,
      baseUrl: 'http://127.0.0.1:${server.port}/api',
    );
  });
  tearDown(() async {
    feed?.dispose();
    feed = null;
    settings.dispose();
    repository.dispose();
    await server.close(force: true);
    await store.close();
  });
  test('普通搜索保留仅正文命中的轻量结果，跨页及离线恢复不丢失', () async {
    await settings.update(settings.value.copyWith(blacklistKeywords: ['屏蔽']));
    final records = [
      Notice(
        id: 'body-1',
        title: '第一项办理安排',
        source: '教务处',
        publishDate: '2026-10-30',
        originUrl: 'https://ustc.edu.cn/body-1',
        cleanContent: '正文中的量子芯片实验室安排。',
      ),
      Notice(
        id: 'blocked',
        title: '屏蔽通知',
        source: '教务处',
        publishDate: '2026-10-30',
        originUrl: 'https://ustc.edu.cn/blocked',
        cleanContent: '量子芯片实验室安排。',
      ),
      Notice(
        id: 'body-2',
        title: '第二项办理安排',
        source: '教务处',
        publishDate: '2026-10-29',
        originUrl: 'https://ustc.edu.cn/body-2',
        cleanContent: '量子芯片实验室安排。',
      ),
    ];
    var offline = false;
    final requests = <Uri>[];
    handle = (request) async {
      requests.add(request.uri);
      if (offline) {
        respond(request, [], 0, status: 503);
        return;
      }
      final word = request.uri.queryParameters['keyword'] ?? '';
      final matches = records
          .where(
            (n) => '${n.title} ${n.source} ${n.aiSummary} ${n.cleanContent}'
                .contains(word),
          )
          .toList();
      final next = request.uri.queryParameters['cursor'] != null;
      final page = next ? matches.skip(2) : matches.take(2);
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'items': page
              .map((n) => {...n.toJson(), 'cleanContent': ''})
              .toList(),
          'total': matches.length,
          'nextCursor': !next && matches.length > 2 ? 'body-next' : null,
        }),
      );
      await request.response.close();
    };
    feed = NoticeFeed(repository, settings);
    await feed!.search('量子芯片');
    expect(feed!.visible.map((n) => n.id), ['body-1']);
    expect(feed!.visible.single.cleanContent, isEmpty);
    expect(feed!.finished, isFalse);
    await feed!.loadMore();
    expect(feed!.visible.map((n) => n.id), ['body-1', 'body-2']);
    expect(feed!.finished, isTrue);
    expect(
      requests.every(
        (uri) =>
            uri.queryParameters['keyword'] == '量子芯片' &&
            uri.queryParameters['light'] == 'true',
      ),
      isTrue,
    );
    expect(requests.last.queryParameters['cursor'], 'body-next');
    feed!.dispose();
    offline = true;
    feed = NoticeFeed(repository, settings);
    await feed!.search('量子芯片');
    expect(feed!.visible.map((n) => n.id), ['body-1', 'body-2']);
    expect(feed!.error, contains('503'));
  });

  test('高级搜索保留正文命中，同时继续应用本地订阅、已读、收藏、标签和屏蔽规则', () async {
    Notice item(
      String id, {
      String source = '教务处',
      List<String> categories = const ['research'],
      String contentType = 'notice',
    }) => Notice(
      id: id,
      title: id == 'blocked' ? '屏蔽通知' : '办理安排',
      source: source,
      categories: categories,
      contentType: contentType,
      publishDate: '2026-10-30',
      deadline: '2026-11-02',
      originUrl: 'https://ustc.edu.cn/$id',
      cleanContent: '仅正文包含实验室安排。',
    );
    final records = [
      item('kept'),
      item('unread'),
      item('unstarred'),
      item('untagged'),
      item('blocked'),
      item('source', source: '研究生院'),
      item('category', categories: ['exam']),
      item('type', contentType: 'news'),
    ];
    await settings.update(
      settings.value.copyWith(
        subscriptionMode: 'custom',
        subscribedDepts: ['教务处'],
        categoryMode: 'custom',
        subscribedCategories: ['exam'],
        readIds: records
            .where((n) => n.id != 'unread')
            .map((n) => n.id)
            .toList(),
        starredIds: records
            .where((n) => n.id != 'unstarred')
            .map((n) => n.id)
            .toList(),
        customTags: {
          for (final n in records.where((n) => n.id != 'untagged'))
            n.id: ['跟进'],
        },
        blacklistKeywords: ['屏蔽'],
      ),
    );
    handle = (request) async {
      final word = request.uri.queryParameters['keyword'] ?? '';
      final matches = records
          .where((n) => n.cleanContent.contains(word))
          .toList();
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'items': matches
              .map((n) => {...n.toJson(), 'cleanContent': ''})
              .toList(),
          'total': matches.length,
          'nextCursor': null,
        }),
      );
      await request.response.close();
    };
    feed = NoticeFeed(repository, settings);
    await feed!.apply(
      const FeedFilters(
        keyword: '实验室安排',
        categories: ['research'],
        contentType: 'notice',
        isRead: true,
        isStarred: true,
        tags: ['跟进'],
        hasDeadline: true,
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
      ),
    );
    expect(feed!.visible.map((n) => n.id), ['kept']);
    expect(feed!.visible.single.cleanContent, isEmpty);
  });
  test('清除高级筛选后不会留下不可见的旧搜索词', () async {
    final dataset = [notice('course', '课程安排'), notice('award', '奖学金')];
    handle = (request) async {
      final word = request.uri.queryParameters['keyword'];
      final items = dataset
          .where((n) => word == null || n.title.contains(word))
          .toList();
      respond(request, items, items.length);
    };
    feed = NoticeFeed(repository, settings);
    await feed!.search('课程');
    expect(feed!.visible.map((n) => n.id), ['course']);
    await feed!.apply(const FeedFilters(keyword: '课程', isRead: false));
    await feed!.apply(null);
    expect(feed!.visible.map((n) => n.id), ['course', 'award']);
    expect(feed!.keyword, isEmpty);
  });
  test('较慢的旧筛选响应不能覆盖新搜索结果', () async {
    final oldStarted = Completer<void>(), releaseOld = Completer<void>();
    handle = (request) async {
      final keyword = request.uri.queryParameters['keyword'];
      if (keyword == '旧') {
        oldStarted.complete();
        await releaseOld.future;
      }
      respond(request, [
        notice(keyword == '旧' ? 'old' : 'new', '$keyword通知'),
      ], 1);
    };
    feed = NoticeFeed(repository, settings)..keyword = '旧';
    final old = feed!.refresh();
    await oldStarted.future;
    await feed!.search('新');
    releaseOld.complete();
    await old;
    expect(feed!.visible.map((n) => n.id), ['new']);
    expect(feed!.error, isNull);
  });
  test('本地屏蔽仅扫描有限页并提供继续查找，不误报全部为空', () async {
    await settings.update(settings.value.copyWith(blacklistKeywords: ['屏蔽']));
    final requestedPages = <int>[];
    handle = (request) async {
      final page = int.parse(request.uri.queryParameters['page']!);
      requestedPages.add(page);
      respond(
        request,
        page <= 5
            ? List.generate(
                15,
                (index) => notice('page_${page}_$index', '屏蔽内容'),
              )
            : [notice('visible', '有效通知')],
        76,
      );
    };
    feed = NoticeFeed(repository, settings);
    await feed!.refresh();
    expect(feed!.visible, isEmpty);
    expect(feed!.finished, isFalse);
    expect(feed!.scanPaused, isTrue);
    expect(requestedPages, [1, 2, 3, 4, 5]);
    await feed!.loadMore();
    expect(feed!.visible.map((n) => n.id), ['visible']);
    expect(feed!.finished, isTrue);
  });
  test('刷新失败保留数据，收藏与重要操作不重新请求通知流', () async {
    var fail = false, requests = 0;
    handle = (request) async {
      requests++;
      respond(request, [notice('one', '通知')], 1, status: fail ? 503 : 200);
    };
    feed = NoticeFeed(repository, settings);
    await feed!.refresh();
    await settings.favorite('one', 'default');
    await settings.toggleImportant('one');
    expect(requests, 1);
    fail = true;
    await feed!.refresh();
    expect(feed!.visible.map((n) => n.id), ['one']);
    expect(feed!.error, contains('503'));
    expect(settings.value.starredIds, contains('one'));
    expect(settings.value.importantIds, contains('one'));
  });
}
