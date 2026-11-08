import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/app.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/data/notice_repository.dart';
import 'package:notifai_mobile/features/organizer.dart';
import 'package:notifai_mobile/services/platform_actions.dart';
import 'package:notifai_mobile/services/reminder_service.dart';
import 'package:notifai_mobile/state/user_settings.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class FakeRepository extends NoticeRepository {
  FakeRepository({required super.store})
    : super(baseUrl: 'https://example.org/api');
  final List<List<String>> requests = [];
  final Map<String, Notice> details = {};
  final Map<String, Notice> summaries = {};
  bool failBatch = false;

  static Notice noticeFor(String id) => Notice(
    id: id,
    title: '通知 ${id.substring(1)}',
    source: '教务处',
    categories: const [],
    publishDate: id == 'n0' ? null : '2026-10-30',
    originUrl: '',
    cleanContent: '',
  );

  @override
  Future<CachedValue<Notice>?> cachedDetail(String id) async =>
      details[id] == null ? null : CachedValue(details[id]!, DateTime.now());

  @override
  Future<CachedValue<Notice>?> cachedSummary(String id) async =>
      summaries[id] == null
      ? null
      : CachedValue(summaries[id]!, DateTime.now());

  @override
  Future<List<Notice>> batch(List<String> ids, {bool light = false}) async {
    requests.add([...ids]);
    if (failBatch) throw const ApiException('当前处于离线状态');
    return [for (final id in ids) noticeFor(id)];
  }
}

void main() {
  late LocalStore store;
  late UserSettings settings;
  late FakeRepository repository;
  late AppServices services;

  setUp(() async {
    sqfliteFfiInit();
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = UserSettings(store);
    await settings.initialize();
    repository = FakeRepository(store: store);
    services = AppServices(
      store: store,
      repository: repository,
      settings: settings,
      actions: PlatformActions(webBaseUrl: defaultWebBase),
      reminders: ReminderService(store, repository, settings),
    );
  });

  tearDown(() async {
    services.reminders.dispose();
    settings.dispose();
    repository.dispose();
    await store.close();
  });

  Future<void> pump(
    WidgetTester tester, {
    bool important = false,
    bool readHistory = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SavedNotices(
            services: services,
            important: important,
            readHistory: readHistory,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> mutate(
    WidgetTester tester,
    Future<void> Function() action,
  ) async {
    await tester.runAsync(action);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pumpAndSettle();
  }

  Future<void> seed(WidgetTester tester, int count) async {
    final ids = [for (var i = 0; i < count; i++) 'n$i'];
    await mutate(
      tester,
      () => settings.update(settings.value.copyWith(starredIds: ids)),
    );
    await pump(tester);
  }

  testWidgets('一万条收藏首屏只请求前 50 条', (tester) async {
    await seed(tester, 10000);
    expect(repository.requests, hasLength(1));
    expect(repository.requests.single, hasLength(50));
    expect(repository.requests.single.first, 'n0');
    expect(find.text('通知 0'), findsOneWidget);
  });

  testWidgets('滚动加载下一页且不重复请求第一页', (tester) async {
    await seed(tester, 200);
    expect(repository.requests.single.first, 'n0');
    for (var i = 0; i < 30 && repository.requests.length == 1; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, -500));
      await tester.pumpAndSettle();
    }
    expect(repository.requests.length, greaterThanOrEqualTo(2));
    expect(repository.requests[1], hasLength(50));
    expect(repository.requests[1].first, 'n50');
    expect(repository.requests[1], isNot(contains('n0')));
  });

  testWidgets('已读变化不重新请求，删除收藏立即移除', (tester) async {
    await seed(tester, 200);
    final requests = repository.requests.length;
    await mutate(tester, () => settings.markRead('n0'));
    expect(repository.requests.length, requests);
    await mutate(tester, () => settings.unfavorite('n0'));
    expect(find.text('通知 0'), findsNothing);
    expect(repository.requests.length, requests);
  });

  testWidgets('切换收藏夹重置窗口并只加载该目录', (tester) async {
    await seed(tester, 200);
    await mutate(tester, () => settings.createFolder('重点'));
    final folder = settings.value.folders.firstWhere(
      (item) => item.name == '重点',
    );
    await mutate(
      tester,
      () => settings.update(
        settings.value.copyWith(
          starredFolderMap: {for (var i = 0; i < 75; i++) 'n$i': folder.id},
        ),
      ),
    );
    await tester.tap(find.text('重点'));
    await tester.pumpAndSettle();
    expect(repository.requests.last, hasLength(50));
    expect(repository.requests.last.first, 'n0');
    expect(
      repository.requests.last.every((id) => int.parse(id.substring(1)) < 75),
      isTrue,
    );
  });

  testWidgets('已读历史按最近阅读倒序加载首屏', (tester) async {
    await mutate(
      tester,
      () =>
          settings.update(settings.value.copyWith(readIds: ['n0', 'n1', 'n2'])),
    );
    await pump(tester, readHistory: true);
    expect(repository.requests.single, ['n2', 'n1', 'n0']);
    expect(find.text('通知 2'), findsOneWidget);
  });

  testWidgets('离线时首屏展示完整详情与摘要缓存且不请求网络', (tester) async {
    final ids = [for (var i = 0; i < 60; i++) 'n$i'];
    await mutate(
      tester,
      () => settings.update(settings.value.copyWith(starredIds: ids)),
    );
    for (var i = 0; i < 25; i++) {
      repository.details['n$i'] = FakeRepository.noticeFor('n$i');
    }
    for (var i = 25; i < 50; i++) {
      repository.summaries['n$i'] = FakeRepository.noticeFor('n$i');
    }
    repository.failBatch = true;
    await pump(tester);
    expect(repository.requests, isEmpty);
    expect(find.text('通知 0'), findsOneWidget);
    expect(find.textContaining('未知'), findsWidgets);
    expect(find.textContaining('保留 50 条本地内容'), findsOneWidget);
  });

  testWidgets('新增收藏加入当前窗口而不重载首屏', (tester) async {
    await seed(tester, 60);
    await mutate(tester, () => settings.favorite('n60', 'default'));
    expect(repository.requests.last, ['n60']);
  });
}
