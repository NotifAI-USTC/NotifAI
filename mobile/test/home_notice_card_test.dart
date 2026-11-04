import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/app.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/data/notice_repository.dart';
import 'package:notifai_mobile/services/platform_actions.dart';
import 'package:notifai_mobile/services/reminder_service.dart';
import 'package:notifai_mobile/state/user_settings.dart';
import 'package:notifai_mobile/ui/home_notice_card.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  late LocalStore store;
  late UserSettings settings;
  late AppServices services;
  final notice = Notice(
    id: 'one',
    title: '选课安排',
    source: '教务处',
    publishDate: '2026-10-30',
    originUrl: 'https://ustc.edu.cn/one',
  );
  setUp(() async {
    sqfliteFfiInit();
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = UserSettings(store);
    await settings.initialize();
    final repository = NoticeRepository(
      store: store,
      baseUrl: 'https://example.org/api',
    );
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
    services.repository.dispose();
    await store.close();
  });
  Future<void> render(WidgetTester tester, {VoidCallback? open}) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomeNoticeCard(
            notice: notice,
            services: services,
            onOpen: open ?? () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> swipe(WidgetTester tester, double x) async {
    await tester.drag(find.byType(Dismissible), Offset(x, 0));
    await tester.pumpAndSettle();
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
  }

  testWidgets('左滑持久切换已读和未读，不改变收藏重要或移除卡片', (tester) async {
    await tester.runAsync(() async {
      await settings.markRead('other');
      await settings.favorite('one', 'default');
      await settings.toggleImportant('one');
    });
    var opened = false;
    await render(tester, open: () => opened = true);
    await swipe(tester, -600);
    expect(settings.value.readIds, containsAll(['other', 'one']));
    expect(find.text('选课安排'), findsOneWidget);
    await swipe(tester, -600);
    expect(settings.value.readIds, ['other']);
    expect(settings.value.starredIds, ['one']);
    expect(settings.value.importantIds, ['one']);
    final raw =
        await tester.runAsync(() => store.read(settingsStorageKey)) as Map;
    expect(raw['readIds'], ['other']);
    expect(opened, isFalse);
    await tester.tap(find.text('选课安排'));
    expect(opened, isTrue);
  });
  testWidgets('右滑切换置顶，不改变已读或删除通知，短滑不提交', (tester) async {
    await render(tester);
    await swipe(tester, 80);
    expect(settings.value.pinnedIds, isEmpty);
    await swipe(tester, 600);
    expect(settings.value.pinnedIds, ['one']);
    expect(find.byIcon(Icons.push_pin), findsOneWidget);
    expect(settings.value.readIds, isEmpty);
    await swipe(tester, 600);
    expect(settings.value.pinnedIds, isEmpty);
    expect(find.text('选课安排'), findsOneWidget);
  });
  testWidgets('长按弹出菜单，收藏和标签实际写入，分享仍可选择方式', (tester) async {
    await render(tester);
    expect(find.byType(IconButton), findsNothing);
    await tester.longPress(find.text('选课安排'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('收藏通知'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('默认收藏'));
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    expect(settings.value.starredIds, ['one']);
    await tester.longPress(find.text('选课安排'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('管理标签'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('添加标签'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '课程');
    await tester.tap(find.text('保存'));
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    expect(settings.value.customTags['one'], ['课程']);
    Navigator.of(tester.element(find.text('通知标签'))).pop();
    await tester.pumpAndSettle();
    await tester.longPress(find.text('选课安排'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('分享通知'));
    await tester.pumpAndSettle();
    expect(find.text('复制链接'), findsOneWidget);
  });
  testWidgets('分享二维码使用新公开域名并保留网页详情地址', (tester) async {
    await render(tester);
    await tester.longPress(find.text('选课安排'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('分享通知'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('显示二维码'));
    await tester.pumpAndSettle();
    expect(find.text('https://notifai.top/#/detail/one'), findsOneWidget);
    expect(
      find.text('https://notifai.enthusjast.cc/#/detail/one'),
      findsNothing,
    );
  });
  testWidgets('键盘可切换已读置顶并打开长按菜单', (tester) async {
    await render(tester);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyR);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    expect(settings.value.readIds, ['one']);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.altLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.keyP);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.altLeft);
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 100));
    });
    await tester.pumpAndSettle();
    expect(settings.value.pinnedIds, ['one']);
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.f10);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    await tester.pumpAndSettle();
    expect(find.text('收藏通知'), findsOneWidget);
    expect(find.text('分享通知'), findsOneWidget);
    expect(find.text('管理标签'), findsOneWidget);
  });
  testWidgets('数据库写入失败不提前切换卡片状态', (tester) async {
    await render(tester);
    await tester.runAsync(
      () => store.database.execute(
        "CREATE TRIGGER fail_read BEFORE INSERT ON kv BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
      ),
    );
    await swipe(tester, -600);
    expect(settings.value.readIds, isEmpty);
    expect(find.text('选课安排'), findsOneWidget);
    expect(find.byType(SnackBar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
