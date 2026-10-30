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
