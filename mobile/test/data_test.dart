import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/data/notice_repository.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

Map<String, dynamic> noticeJson([String id = 'n1']) => {
  'id': id,
  'title': '关于选课的通知',
  'source': '计算机科学与技术学院',
  'categories': ['course_selection'],
  'contentType': 'notice',
  'publishDate': '2026-10-30',
  'deadline': '2026-11-02',
  'originUrl': 'https://www.ustc.edu.cn/notice/$id',
  'cleanContent': '# 完整正文\n选课说明',
  'attachments': [
    {'name': '选课表.pdf', 'url': 'https://example.org/files/form.pdf'},
  ],
};
Map<String, dynamic> pageJson(List<Object?> items) => {
  'items': items,
  'total': items.length,
  'nextCursor': null,
};

// Construct the real dart:io client without the widget binding's HTTP-400
// override. The repository still talks to an actual local HttpServer.
class RealHttpOverrides extends HttpOverrides {}

class StreamingClient extends http.BaseClient {
  StreamingClient(this.handle);
  final Future<http.StreamedResponse> Function(http.BaseRequest) handle;
  bool closed = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      handle(request);
  @override
  void close() {
    closed = true;
  }
}

http.StreamedResponse jsonResponse(Object? value, {int status = 200}) =>
    http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(value))),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late LocalStore store;
  setUpAll(sqfliteFfiInit);
  setUp(() async {
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
  });
  tearDown(() async {
    await store.close();
  });

  group('运行时模型与日期', () {
    test('日期保持本地日历日，闰日和越界日期严格校验', () {
      final date = parseDateOnly('2024-02-29');
      expect(date.isUtc, isFalse);
      expect(dateOnly(date), '2024-02-29');
      expect(
        () => parseDateOnly('2025-02-29'),
        throwsA(isA<DataValidationException>()),
      );
      expect(
        () => parseDateOnly('2026-13-01'),
        throwsA(isA<DataValidationException>()),
      );
      expect(
        () => parseDateOnly('1999-12-31'),
        throwsA(isA<DataValidationException>()),
      );
      expect(
        () => parseDateOnly('2026-01-01T00:00:00Z'),
        throwsA(isA<DataValidationException>()),
      );
      expect(
        remainingDays('2026-11-02', now: DateTime(2026, 10, 30, 23, 59)),
        3,
      );
      expect(remainingDays('2026-10-29', now: DateTime(2026, 10, 30)), -1);
      final n = Notice.fromJson({
        ...noticeJson(),
        'publishDate': '2026-10-30T23:00:00-10:00',
      });
      expect(n.publishDate, '2026-10-30');
    });
    test('可选字段按 Web 语义兼容，集合不允许外部修改', () {
      final json = noticeJson()
        ..['aiSummary'] = 42
        ..['targetAudience'] = null
        ..['coreAction'] = 'a' * 2100
        ..['firstSeen'] = '2026-10-30T12:20:00+08:00';
      final n = Notice.fromJson(json);
      expect(n.source, '计算机学院');
      expect(n.aiSummary, '');
      expect(n.targetAudience, '');
      expect(n.coreAction.length, 2000);
      expect(n.firstSeen, '2026-10-30T12:20:00+08:00');
      expect(() => n.categories.add('other'), throwsUnsupportedError);
      expect(() => n.attachments.clear(), throwsUnsupportedError);
      (json['categories'] as List).clear();
      expect(n.categories, ['course_selection']);
      expect(Notice.fromJson(n.toJson()).cleanContent, n.cleanContent);
    });
    test('拒绝不可信原文、凭据、非法附件、分类和时间戳', () {
      for (final url in [
        'http://www.ustc.edu.cn/a',
        'https://ustc.edu.cn.evil.org/a',
        'https://user:pass@www.ustc.edu.cn/a',
        'https://@www.ustc.edu.cn/a',
        'https://.ustc.edu.cn/a',
        'javascript:alert(1)',
        'https://www.ustc.edu.cn:70000/a',
      ]) {
        expect(
          () => Notice.fromJson({...noticeJson(), 'originUrl': url}),
          throwsA(isA<DataValidationException>()),
          reason: url,
        );
      }
      for (final patch in <Map<String, dynamic>>[
        {
          'categories': ['other', 'other'],
        },
        {
          'categories': ['unknown'],
        },
        {'contentType': 'article'},
        {'id': '../secret'},
        {'firstSeen': '2026-02-30T12:00:00Z'},
        {'lastCrawl': '2026-10-30T25:00:00Z'},
        {
          'attachments': [
            {'name': 'x', 'url': 'https://name:secret@example.org/x'},
          ],
        },
        {
          'attachments': [
            {'name': 'x', 'url': 'https://@example.org/x'},
          ],
        },
      ]) {
        expect(
          () => Notice.fromJson({...noticeJson(), ...patch}),
          throwsA(isA<DataValidationException>()),
        );
      }
      expect(
        Notice.fromJson({
          ...noticeJson(),
          'originUrl': 'https://www.ustc.edu.cn/path/@name?contact=a@b',
        }).originUrl,
        'https://www.ustc.edu.cn/path/@name?contact=a@b',
      );
    });
    test('跳过单条脏数据但保留原始分页计数，拒绝重复与错误元数据', () {
      final page = NoticePage.fromJson({
        ...pageJson([
          noticeJson(),
          {'id': 'bad'},
          noticeJson('n2'),
        ]),
        'total': 2,
      });
      expect(page.items.map((n) => n.id), ['n1', 'n2']);
      expect(page.rawItemCount, 3);
      expect(page.invalidItemCount, 1);
      expect(
        () => NoticePage.fromJson(pageJson([noticeJson(), noticeJson()])),
        throwsA(isA<DataValidationException>()),
      );
      for (final metadata in [
        {'total': -1},
        {'total': 0},
        {'total': 1.5},
        {'nextCursor': ''},
        {'nextCursor': 12},
      ]) {
        expect(
          () => NoticePage.fromJson({
            ...pageJson([noticeJson()]),
            ...metadata,
          }),
          throwsA(isA<DataValidationException>()),
        );
      }
    });
    test('轻量日历与截止模型校验，统计保留 Web 可选字段规则', () {
      final deadline = DeadlineEntry.fromJson(noticeJson());
      expect(deadline.deadline, '2026-11-02');
      expect(
        () => DeadlineEntry.fromJson({...noticeJson(), 'deadline': null}),
        throwsA(isA<DataValidationException>()),
      );
      expect(
        Stats.fromJson({'total': 'bad', 'sourceCount': 2, 'lastCrawlAt': 'bad'})
            .total,
        0,
      );
      expect(
        Stats.fromJson({'total': 3, 'sourceCount': 2, 'lastCrawlAt': 'bad'})
            .lastCrawlAt,
        isNull,
      );
      expect(
        () => Stats.fromJson({'lastCrawlAt': 12}),
        throwsA(isA<DataValidationException>()),
      );
    });
    test('查询数组规范化，cacheKey 无页码光标且数组顺序无关', () {
      final q = NoticeQuery(
        sources: ['教务处', '计算机科学与技术学院', '教务处'],
        categories: ['other', 'exam'],
        excludeIds: ['', 'n2', 'n1', 'n2'],
        hasDeadline: false,
      );
      final p = q.toParameters();
      expect(p['sources[]'], ['教务处', '计算机学院']);
      expect(p['excludeIds[]'], ['n2', 'n1']);
      expect(p['hasDeadline'], 'false');
      expect(
        q.cacheKey,
        q
            .copyWith(
              page: 100,
              cursor: 'opaque',
              sources: ['计算机学院', '教务处'],
              categories: ['exam', 'other'],
              excludeIds: ['n1', 'n2'],
            )
            .cacheKey,
      );
      expect(
        q.copyWith(cursor: 'cursor').copyWith(cursor: null).cursor,
        isNull,
      );
      for (final bad in [
        NoticeQuery(page: 0),
        NoticeQuery(pageSize: 1001),
        NoticeQuery(categories: ['bad']),
        NoticeQuery(sources: List.filled(101, 'a')),
        NoticeQuery(dateFrom: '2026-11-01', dateTo: '2026-10-01'),
        NoticeQuery(excludeIds: ['../x']),
      ]) {
        expect(bad.toParameters, throwsA(isA<DataValidationException>()));
      }
    });
  });

  group('SQLite 持久性与原子性', () {
    test('null 删除；序列化失败和 SQLite 失败均不部分提交', () async {
      await store.writeAll({
        'a': {'n': 1},
        'b': [1, '二'],
      });
      expect(await store.read('a'), {'n': 1});
      await expectLater(
        store.writeAll({'a': 2, 'b': Object()}),
        throwsA(anything),
      );
      expect(await store.read('a'), {'n': 1});
      await store.database.execute(
        "CREATE TRIGGER reject_bad BEFORE INSERT ON kv WHEN NEW.key = 'bad' BEGIN SELECT RAISE(ABORT, 'blocked'); END",
      );
      await expectLater(
        store.writeAll({'a': 3, 'bad': true}),
        throwsA(isA<DatabaseException>()),
      );
      expect(await store.read('a'), {'n': 1});
      expect(await store.read('bad'), isNull);
      await store.write('a', null);
      expect(await store.read('a'), isNull);
    });
    test('关闭再打开保留数据且数据库错误显式传播', () async {
      final dir = await Directory.systemTemp.createTemp('notifai-data-test-');
      final path = '${dir.path}/test.sqlite';
      final first = await LocalStore.open(
        path: path,
        factory: databaseFactoryFfi,
      );
      try {
        await first.write('preferences', {'enabled': true});
        await first.close();
        final second = await LocalStore.open(
          path: path,
          factory: databaseFactoryFfi,
        );
        try {
          expect(await second.read('preferences'), {'enabled': true});
        } finally {
          await second.close();
        }
        await expectLater(first.write('x', 1), throwsA(anything));
      } finally {
        await dir.delete(recursive: true);
      }
    });
  });

  group('真实传输与响应边界', () {
    test('HTTP 实际序列化数组和批量正文，动态目录和缓存可用', () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final seen = <Uri>[];
      Object? postBody;
      final subscription = server.listen((request) async {
        seen.add(request.uri);
        request.response.headers.contentType = ContentType.json;
        if (request.method == 'POST') {
          postBody = jsonDecode(await utf8.decoder.bind(request).join());
          request.response.write(
            jsonEncode({
              'items': [noticeJson()],
              'missing': [],
            }),
          );
        } else if (request.uri.path.endsWith('/sources')) {
          request.response.write(
            jsonEncode([
              {'name': '教务处', 'group': '校级部门', 'noticeCount': 8},
            ]),
          );
        } else {
          request.response.write(
            jsonEncode(
              pageJson([
                noticeJson(),
                {'id': 'bad'},
              ]),
            ),
          );
        }
        await request.response.close();
      });
      final client = IOClient(RealHttpOverrides().createHttpClient(null));
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'http://127.0.0.1:${server.port}/api',
        client: client,
      );
      try {
        final result = await repository.list(
          NoticeQuery(
            sources: ['教务处', '图书馆'],
            categories: ['exam'],
            excludeIds: ['n9'],
          ),
        );
        expect(seen.first.path, '/api/notices');
        expect(seen.first.queryParametersAll['sources[]'], ['教务处', '图书馆']);
        expect(seen.first.queryParametersAll['categories[]'], ['exam']);
        expect(seen.first.queryParametersAll['excludeIds[]'], ['n9']);
        expect(result.rawItemCount, 2);
        expect(result.invalidItemCount, 1);
        expect(await repository.cachedDetail('n1'), isNull);
        await repository.batch(['n1', 'n1']);
        expect(postBody, {
          'ids': ['n1'],
        });
        expect(
          (await repository.cachedDetail('n1'))!.value.cleanContent,
          contains('完整正文'),
        );
        await repository.sources();
        expect((await repository.cachedSources())!.value.single.noticeCount, 8);
      } finally {
        repository.dispose();
        client.close();
        await server.close(force: true);
        await subscription.cancel();
      }
    });
    test('API 状态和错误正文保留，目录缓存不掩盖网络错误', () async {
      var fail = false;
      final client = StreamingClient(
        (_) async => fail
            ? jsonResponse({'error': 'service unavailable'}, status: 503)
            : jsonResponse([
                {'name': '图书馆', 'group': '校级部门', 'noticeCount': 4},
              ]),
      );
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org/api',
        client: client,
      );
      await repository.sources();
      fail = true;
      await expectLater(
        repository.sources(),
        throwsA(
          isA<ApiException>()
              .having((e) => e.statusCode, 'statusCode', 503)
              .having(
                (e) => e.responseBody,
                'responseBody',
                contains('service unavailable'),
              ),
        ),
      );
      expect((await repository.cachedSources())!.value.single.noticeCount, 4);
      repository.dispose();
      expect(client.closed, isFalse);
      client.close();
    });
    test('无效 UTF-8 错误页仍保留 HTTP 状态，成功页必须是合法 JSON', () async {
      var status = 502;
      final client = StreamingClient(
        (_) async => http.StreamedResponse(Stream.value([0xff, 0xfe]), status),
      );
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      await expectLater(
        repository.stats(),
        throwsA(
          isA<ApiException>().having((e) => e.statusCode, 'statusCode', 502),
        ),
      );
      status = 200;
      await expectLater(
        repository.stats(),
        throwsA(
          isA<ApiException>()
              .having((e) => e.message, 'message', contains('JSON'))
              .having((e) => e.cause, 'cause', isA<FormatException>()),
        ),
      );
      repository.dispose();
      client.close();
    });
    test('拒绝无效 JSON、重复通知、错误详情 ID、批量越权 ID 与目录元数据', () async {
      Object? response;
      final client = StreamingClient((_) async => jsonResponse(response));
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      response = pageJson([noticeJson(), noticeJson()]);
      await expectLater(
        repository.list(NoticeQuery()),
        throwsA(isA<ApiException>()),
      );
      response = noticeJson('n2');
      await expectLater(repository.detail('n1'), throwsA(isA<ApiException>()));
      expect(await repository.cachedDetail('n2'), isNull);
      for (final bad in [
        {
          'items': [noticeJson('outside')],
          'missing': [],
        },
        {
          'items': [noticeJson(), noticeJson()],
          'missing': [],
        },
        {
          'items': [noticeJson()],
          'missing': ['n1'],
        },
        {
          'items': [],
          'missing': ['n1', 'n1'],
        },
        {
          'items': [],
          'missing': ['outside'],
        },
      ]) {
        response = bad;
        await expectLater(
          repository.batch(['n1']),
          throwsA(isA<ApiException>()),
        );
      }
      response = [
        {'name': '教务处', 'group': '校级部门', 'noticeCount': -1},
      ];
      await expectLater(repository.sources(), throwsA(isA<ApiException>()));
      response = [
        {'name': '计算机学院', 'group': '二级学院', 'noticeCount': 1},
        {'name': '计算机科学与技术学院', 'group': '二级学院', 'noticeCount': 2},
      ];
      await expectLater(repository.sources(), throwsA(isA<ApiException>()));
      response = categoryNames.entries
          .map(
            (e) => {
              'key': e.key,
              'name': e.value,
              'description': '分类描述',
              'noticeCount': 1,
            },
          )
          .toList();
      expect((await repository.categories()).length, 17);
      response = (response as List).take(16).toList();
      await expectLater(repository.categories(), throwsA(isA<ApiException>()));
      expect((await repository.cachedCategories())!.value.length, 17);
      repository.dispose();
      client.close();
    });
    test('分块下载限制同时覆盖 Content-Length 和真实流长度', () async {
      var declared = true;
      final client = StreamingClient(
        (_) async => declared
            ? http.StreamedResponse(
                const Stream.empty(),
                200,
                contentLength: 8 * 1024 * 1024 + 1,
              )
            : http.StreamedResponse(
                Stream.value(Uint8List(8 * 1024 * 1024 + 1)),
                200,
              ),
      );
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      await expectLater(
        repository.detail('n1'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            contains('过大'),
          ),
        ),
      );
      declared = false;
      await expectLater(
        repository.detail('n1'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            contains('过大'),
          ),
        ),
      );
      expect(await repository.cachedDetail('n1'), isNull);
      repository.dispose();
      client.close();
    });
    testWidgets('10 秒超时触发取消，不会伪装空数据', (tester) async {
      var aborted = false;
      final client = StreamingClient((request) {
        (request as http.Abortable).abortTrigger!.then((_) {
          aborted = true;
        });
        return Completer<http.StreamedResponse>().future;
      });
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      final check = expectLater(
        repository.list(NoticeQuery()),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            contains('超时'),
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 11));
      await check;
      expect(aborted, isTrue);
      repository.dispose();
      client.close();
    });
    test('无效基础地址与查询在请求前失败', () async {
      for (final url in [
        '/api',
        'http://example.org',
        'https://user:pass@example.org',
        'https://@example.org',
        'https://example.org?query=1',
        'https://example.org#frag',
        'https://example.org:70000',
        'file:///api',
      ]) {
        expect(
          () => NoticeRepository(store: store, baseUrl: url),
          throwsA(isA<ApiException>()),
          reason: url,
        );
      }
      var sent = 0;
      final client = StreamingClient((_) async {
        sent++;
        return jsonResponse({});
      });
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      await expectLater(
        repository.calendar(month: '2026-13'),
        throwsA(isA<DataValidationException>()),
      );
      await expectLater(
        repository.calendar(month: '2026-10', week: '2026-W44'),
        throwsA(isA<DataValidationException>()),
      );
      await expectLater(
        repository.calendar(week: '2025-W53'),
        throwsA(isA<DataValidationException>()),
      );
      await expectLater(
        repository.deadlines(days: 0),
        throwsA(isA<DataValidationException>()),
      );
      await expectLater(
        repository.batch([]),
        throwsA(isA<DataValidationException>()),
      );
      expect(sent, 0);
      repository.dispose();
      client.close();
    });
    test('日历与截止接口跳过脏行但拒绝重复和错误 total', () async {
      Object? response = pageJson([
        noticeJson(),
        {'id': 'broken'},
      ]);
      final client = StreamingClient((_) async => jsonResponse(response));
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      expect(
        (await repository.calendar(month: '2026-10')).entries.single.id,
        'n1',
      );
      expect((await repository.deadlines()).single.deadline, '2026-11-02');
      response = pageJson([noticeJson(), noticeJson()]);
      await expectLater(
        repository.calendar(week: '2026-W44'),
        throwsA(isA<ApiException>()),
      );
      response = {
        ...pageJson([noticeJson()]),
        'total': 0,
      };
      await expectLater(repository.deadlines(), throwsA(isA<ApiException>()));
      repository.dispose();
      client.close();
    });

    test('截止接口转发多来源与页码，短页不触发客户端补扫', () async {
      final requests = <Uri>[];
      final client = StreamingClient((request) async {
        requests.add(request.url);
        return jsonResponse({
          'items': [noticeJson('short-page')],
          'total': 100,
        });
      });
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      final items = await repository.deadlines(
        days: 7,
        sources: const ['教务处', '本科招生网'],
        page: 2,
        pageSize: 1,
      );
      expect(items.single.id, 'short-page');
      expect(requests, hasLength(1));
      expect(requests.single.queryParameters['page'], '2');
      expect(requests.single.queryParameters['pageSize'], '1');
      expect(requests.single.queryParameters['days'], '7');
      expect(requests.single.queryParametersAll['sources[]'], ['教务处', '本科招生网']);
      repository.dispose();
      client.close();
    });
  });

  group('有限持久缓存', () {
    test('轻量列表不能覆盖详情正文，离线合并优先完整详情且保留分页扫描计数', () async {
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
      );
      final full = Notice.fromJson(noticeJson());
      final light = Notice.fromJson({...noticeJson(), 'cleanContent': ''});
      await repository.saveDetail(full);
      await repository.saveFeed(
        NoticeQuery(),
        NoticePage(
          items: [light],
          total: 100,
          invalidItemCount: 2,
          rawItemCount: 8,
        ),
      );
      expect(
        (await repository.cachedDetail('n1'))!.value.cleanContent,
        full.cleanContent,
      );
      expect(
        (await repository.cachedNotices()).single.cleanContent,
        full.cleanContent,
      );
      final feed = (await repository.cachedFeed(
        NoticeQuery(page: 2, cursor: 'next'),
      ))!.value;
      expect(feed.rawItemCount, 8);
      expect(feed.invalidItemCount, 2);
      final restarted = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
      );
      expect(
        (await restarted.cachedDetail('n1'))!.value.cleanContent,
        full.cleanContent,
      );
      final other = NoticeRepository(
        store: store,
        baseUrl: 'https://other.example.org',
      );
      expect(await other.cachedDetail('n1'), isNull);
      repository.dispose();
      restarted.dispose();
      other.dispose();
    });
    test('light batch 只写摘要，不覆盖已有完整详情，缓存失败仍返回网络数据', () async {
      final bodies = <Map<String, dynamic>>[];
      final client = StreamingClient((request) async {
        final body = jsonDecode((request as http.Request).body) as Map;
        bodies.add(body.cast<String, dynamic>());
        final ids = (body['ids'] as List).cast<String>();
        return jsonResponse({
          'items': [
            for (final id in ids) {...noticeJson(id), 'cleanContent': ''},
          ],
          'missing': [],
        });
      });
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      await repository.saveDetail(Notice.fromJson(noticeJson('n1')));
      final items = await repository.batch(['n1', 'n2'], light: true);
      expect(items, hasLength(2));
      expect(bodies.single['light'], isTrue);
      expect(
        (await repository.cachedDetail('n1'))!.value.cleanContent,
        contains('完整正文'),
      );
      expect((await repository.cachedSummary('n1'))!.value.cleanContent, '');
      final cached = await repository.cachedNotices();
      expect(
        cached.firstWhere((n) => n.id == 'n1').cleanContent,
        contains('完整正文'),
      );
      expect(cached.firstWhere((n) => n.id == 'n2').cleanContent, '');

      await store.database.execute(
        "CREATE TRIGGER reject_summary BEFORE INSERT ON kv WHEN NEW.key LIKE '%summary.%' BEGIN SELECT RAISE(ABORT, 'summary blocked'); END",
      );
      final stillReturned = await repository.batch(['n3'], light: true);
      expect(stillReturned.single.id, 'n3');
      expect(repository.cacheWarning, contains('离线缓存写入失败'));
      expect(await repository.cachedSummary('n3'), isNull);
      repository.dispose();
      client.close();
    });
    test('详情最多 500 条、列表最多 20 组，淘汰持久化且不相互覆盖', () async {
      final client = StreamingClient(
        (_) async => jsonResponse({
          'items': List.generate(500, (i) => noticeJson('n$i')),
          'missing': [],
        }),
      );
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      await repository.batch(List.generate(500, (i) => 'n$i'));
      await repository.saveDetail(Notice.fromJson(noticeJson('n500')));
      expect(await repository.cachedDetail('n0'), isNull);
      expect((await repository.cachedDetail('n500'))!.value.id, 'n500');
      for (var i = 0; i < 21; i++) {
        await repository.saveFeed(
          NoticeQuery(keyword: 'q$i'),
          NoticePage(items: [Notice.fromJson(noticeJson('feed$i'))], total: 1),
        );
      }
      expect(await repository.cachedFeed(NoticeQuery(keyword: 'q0')), isNull);
      expect(
        (await repository.cachedFeed(NoticeQuery(keyword: 'q20')))!
            .value
            .items
            .single
            .id,
        'feed20',
      );
      expect(await repository.cachedDetail('feed20'), isNull);
      repository.dispose();
      client.close();
    });
    test('真实详情响应写盘，关闭 SQLite 后冷启动仍可离线读取', () async {
      final directory = await Directory.systemTemp.createTemp(
        'notifai-cache-test-',
      );
      final path = '${directory.path}/cache.sqlite';
      final firstStore = await LocalStore.open(
        path: path,
        factory: databaseFactoryFfi,
      );
      final client = StreamingClient((_) async => jsonResponse(noticeJson()));
      final first = NoticeRepository(
        store: firstStore,
        baseUrl: 'https://example.org/api',
        client: client,
      );
      try {
        final network = await first.detail('n1');
        await first.saveFeed(
          NoticeQuery(),
          NoticePage(items: [network], total: 1),
        );
      } finally {
        first.dispose();
        client.close();
        await firstStore.close();
      }
      try {
        final reopened = await LocalStore.open(
          path: path,
          factory: databaseFactoryFfi,
        );
        final offline = NoticeRepository(
          store: reopened,
          baseUrl: 'https://example.org/api',
        );
        try {
          expect(
            (await offline.cachedDetail('n1'))!.value.cleanContent,
            contains('完整正文'),
          );
          expect((await offline.cachedFeed(NoticeQuery()))!.value.total, 1);
          expect((await offline.cachedNotices()).single.id, 'n1');
        } finally {
          offline.dispose();
          await reopened.close();
        }
      } finally {
        await directory.delete(recursive: true);
      }
    });
    test('SQLite 损坏索引不会阻断真实在线详情和批量响应，恢复范围有限且可见', () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final subscription = server.listen((request) async {
        request.response.headers.contentType = ContentType.json;
        if (request.method == 'POST') {
          final body = jsonDecode(
            await utf8.decoder.bind(request).join(),
          ) as Map<String, dynamic>;
          request.response.write(
            jsonEncode({
              'items': (body['ids'] as List)
                  .map((id) => noticeJson(id as String))
                  .toList(),
              'missing': [],
            }),
          );
        } else {
          request.response.write(
            jsonEncode(noticeJson(request.uri.pathSegments.last)),
          );
        }
        await request.response.close();
      });
      final client = IOClient(RealHttpOverrides().createHttpClient(null));
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'http://127.0.0.1:${server.port}/api',
        client: client,
      );
      final other = NoticeRepository(
        store: store,
        baseUrl: 'https://other.example.org',
      );
      try {
        await repository.saveDetail(Notice.fromJson(noticeJson('old')));
        await repository.saveFeed(
          NoticeQuery(),
          NoticePage(items: [Notice.fromJson(noticeJson('feed1'))], total: 1),
        );
        final indexKey =
            (await store.database.query(
                  'kv',
                  columns: ['key'],
                  where: 'key LIKE ?',
                  whereArgs: ['%detail.index'],
                )).single['key']
                as String;
        await other.saveDetail(Notice.fromJson(noticeJson('other')));
        await store.database.update(
          'kv',
          {'value': '{broken JSON'},
          where: 'key = ?',
          whereArgs: [indexKey],
        );
        expect(repository.cacheWarning, isNull);
        final detail = await repository.detail('n1');
        expect(detail.cleanContent, contains('完整正文'));
        expect(repository.cacheWarning, contains('索引损坏'));
        expect(repository.cacheWarning, contains('已清理并重置'));
        expect(await repository.cachedDetail('old'), isNull);
        expect(
          (await repository.cachedDetail('n1'))!.value.cleanContent,
          detail.cleanContent,
        );
        expect(
          (await repository.cachedFeed(NoticeQuery()))!.value.items.single.id,
          'feed1',
        );
        expect((await other.cachedDetail('other'))!.value.id, 'other');
        expect(await store.read(indexKey), ['n1']);
        await store.write(indexKey, ['n1', 'n1']);
        final batch = await repository.batch(['n2', 'n3']);
        expect(batch.map((n) => n.id), ['n2', 'n3']);
        expect(batch.every((n) => n.cleanContent.contains('完整正文')), isTrue);
        expect(await repository.cachedDetail('n1'), isNull);
        expect(await store.read(indexKey), ['n2', 'n3']);
        expect((await repository.cachedNotices()).map((n) => n.id).toSet(), {
          'feed1',
          'n2',
          'n3',
        });
      } finally {
        repository.dispose();
        other.dispose();
        client.close();
        await server.close(force: true);
        await subscription.cancel();
      }
    });
    test('SQLite 索引恢复失败只降级缓存，不把成功的网络响应变成异常', () async {
      final client = StreamingClient(
        (_) async => jsonResponse(noticeJson('n1')),
      );
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
        client: client,
      );
      try {
        await repository.saveDetail(Notice.fromJson(noticeJson('old')));
        final indexKey =
            (await store.database.query(
                  'kv',
                  columns: ['key'],
                  where: 'key LIKE ?',
                  whereArgs: ['%detail.index'],
                )).single['key']
                as String;
        await store.write(indexKey, {'broken': true});
        await store.database.execute(
          "CREATE TRIGGER reject_recovery BEFORE DELETE ON kv WHEN OLD.key LIKE '%detail.%' BEGIN SELECT RAISE(ABORT, 'recovery blocked'); END",
        );
        final detail = await repository.detail('n1');
        expect(detail.id, 'n1');
        expect(repository.cacheWarning, contains('离线缓存写入失败'));
        expect(await repository.cachedDetail('n1'), isNull);
        expect((await repository.cachedDetail('old'))!.value.id, 'old');
      } finally {
        repository.dispose();
        client.close();
      }
    });
    test('缓存写入 SQLite 失败不会吞掉，损坏持久缓存明确报错', () async {
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
      );
      await store.database.execute(
        "CREATE TRIGGER reject_cache BEFORE INSERT ON kv WHEN NEW.key LIKE '%detail.%' BEGIN SELECT RAISE(ABORT, 'cache blocked'); END",
      );
      await expectLater(
        repository.saveDetail(Notice.fromJson(noticeJson())),
        throwsA(isA<DatabaseException>()),
      );
      expect(await repository.cachedDetail('n1'), isNull);
      await store.database.execute('DROP TRIGGER reject_cache');
      await repository.saveDetail(Notice.fromJson(noticeJson()));
      final row = (await store.database.query(
        'kv',
        where: 'key LIKE ?',
        whereArgs: ['%detail.n1'],
      )).single;
      await store.write(row['key'] as String, {
        'version': 999,
        'savedAt': '2026-10-30T00:00:00Z',
        'value': noticeJson(),
      });
      await expectLater(
        repository.cachedDetail('n1'),
        throwsA(isA<DataValidationException>()),
      );
      repository.dispose();
    });
    test('并发详情写入索引不丢失，陈旧标记不会清除离线正文', () async {
      final repository = NoticeRepository(
        store: store,
        baseUrl: 'https://example.org',
      );
      await Future.wait(
        List.generate(
          10,
          (i) => repository.saveDetail(Notice.fromJson(noticeJson('n$i'))),
        ),
      );
      expect((await repository.cachedNotices()).length, 10);
      final old = CachedValue(
        Notice.fromJson(noticeJson()),
        DateTime.now().subtract(const Duration(days: 31)),
      );
      expect(old.stale, isTrue);
      expect(
        CachedValue(
          old.value,
          DateTime.now().add(const Duration(days: 1)),
        ).stale,
        isFalse,
      );
      expect(old.value.cleanContent, contains('完整正文'));
      repository.dispose();
    });
  });
}
