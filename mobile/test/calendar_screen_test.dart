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

class FakeCalendarRepository extends NoticeRepository {
  FakeCalendarRepository({required super.store})
    : super(baseUrl: 'https://example.org/api');
  final List<Object> results = [];

  @override
  Future<CalendarResult> calendar({String? month, String? week}) async {
    final result = results.removeAt(0);
    if (result is Exception) throw result;
    return result as CalendarResult;
  }
}

void main() {
  late LocalStore store;
  late UserSettings settings;
  late FakeCalendarRepository repository;
  late AppServices services;

  setUp(() async {
    sqfliteFfiInit();
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = UserSettings(store);
    await settings.initialize();
    repository = FakeCalendarRepository(store: store);
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

  testWidgets('日历截断有提示且失败保留上次成功快照', (tester) async {
    repository.results.add(
      const CalendarResult(entries: [], total: 501, truncated: true),
    );
    repository.results.add(const ApiException('离线'));
    await tester.pumpWidget(
      MaterialApp(home: CalendarScreen(services: services)),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('本月通知超过 500 条'), findsOneWidget);
    expect(find.textContaining('共 501 条'), findsOneWidget);

    await tester.tap(find.byTooltip('下一月'));
    await tester.pumpAndSettle();
    expect(find.textContaining('无法加载当前范围通知：离线'), findsOneWidget);
    expect(find.textContaining('以下仍显示上次成功内容'), findsOneWidget);
    expect(find.textContaining('共 501 条'), findsOneWidget);
  });
}
