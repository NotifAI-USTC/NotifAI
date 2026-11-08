import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/app.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/data/notice_repository.dart';
import 'package:notifai_mobile/features/detail.dart';
import 'package:notifai_mobile/services/platform_actions.dart';
import 'package:notifai_mobile/services/reminder_service.dart';
import 'package:notifai_mobile/state/user_settings.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class FakeDetailRepository extends NoticeRepository {
  FakeDetailRepository({required super.store})
    : super(baseUrl: 'https://example.org/api');

  static final notice = Notice(
    id: 'null-date',
    title: '空发布日期通知',
    source: '计算机科学与技术学院',
    categories: const [],
    contentType: 'notice',
    publishDate: null,
    originUrl: '',
    cleanContent: '正文内容',
    lastCrawl: '2026-11-07T16:30:00Z',
  );

  @override
  Future<CachedValue<Notice>?> cachedDetail(String id) async =>
      CachedValue(notice, DateTime.now());

  @override
  Future<Notice> detail(String id) async => notice;
}

class NoopSettings extends UserSettings {
  NoopSettings(super.store);

  @override
  Future<void> markRead(String id) async {}
}

void main() {
  late LocalStore store;
  late NoopSettings settings;
  late FakeDetailRepository repository;
  late AppServices services;

  setUp(() async {
    sqfliteFfiInit();
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = NoopSettings(store);
    await settings.initialize();
    repository = FakeDetailRepository(store: store);
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

  testWidgets('空发布日期详情显示未知且隐藏空官网入口', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: DetailScreen(services: services, id: 'null-date'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('空发布日期通知'), findsOneWidget);
    expect(find.textContaining('未知'), findsWidgets);
    expect(find.text('null'), findsNothing);
    expect(find.text('查看官网'), findsNothing);
    final local = DateTime.parse('2026-11-07T16:30:00Z')
        .toLocal()
        .toString()
        .substring(0, 16);
    expect(find.text('最近抓取：$local'), findsOneWidget);
  });
}
