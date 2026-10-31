import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/data/models.dart';
import 'package:notifai_mobile/ui/deadline_notice_bar.dart';

void main() {
  final today = DateTime(2026, 10, 30);
  DeadlineEntry entry(String id, String date, {String? title}) => DeadlineEntry(
    id: id,
    title: title ?? id,
    source: '教务处',
    publishDate: '2026-10-29',
    deadline: date,
  );
  Future<void> render(
    WidgetTester tester,
    List<DeadlineEntry> entries, {
    double width = 390,
    double scale = 1,
    ValueChanged<String>? onOpen,
  }) async {
    tester.view.physicalSize = Size(width, 900);
    tester.view.devicePixelRatio = 1;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MediaQuery(
            data: MediaQueryData(
              size: Size(width, 900),
              textScaler: TextScaler.linear(scale),
            ),
            child: DeadlineNoticeBar(
              notices: entries,
              now: today,
              onOpen: onOpen ?? (_) {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('排除过期和远期，按日期排序并打开当前紧急通知', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    String? opened;
    final semantics = tester.ensureSemantics();
    await render(tester, [
      entry('远期', '2026-11-03'),
      entry('第三天', '2026-11-02'),
      entry('过期', '2026-10-29'),
      entry('今天', '2026-10-30'),
    ], onOpen: (id) => opened = id);
    expect(find.text('1/2'), findsOneWidget);
    expect(find.text('远期'), findsNothing);
    expect(find.text('过期'), findsNothing);
    expect(
      tester.getSemantics(find.bySemanticsLabel('查看紧急通知：今天，教务处，今天截止')),
      matchesSemantics(
        label: '查看紧急通知：今天，教务处，今天截止',
        isButton: true,
        hasTapAction: true,
      ),
    );
    semantics.dispose();
    await tester.tap(find.text('今天'));
    expect(opened, '今天');
    expect(
      tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (widget) => widget is IconButton && widget.tooltip == '上一条紧急 DDL',
            ),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.byTooltip('下一条紧急 DDL'));
    await tester.pumpAndSettle();
    expect(find.text('2/2'), findsOneWidget);
    expect(
      tester
          .widget<IconButton>(
            find.byWidgetPredicate(
              (widget) => widget is IconButton && widget.tooltip == '下一条紧急 DDL',
            ),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.text('第三天'));
    expect(opened, '第三天');
    await tester.tap(find.byTooltip('上一条紧急 DDL'));
    await tester.pumpAndSettle();
    expect(find.text('1/2'), findsOneWidget);
  });
  testWidgets('手势翻页同步页码，缩减列表后不保留越界页', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final notices = [
      entry('一', '2026-10-30'),
      entry('二', '2026-10-31'),
      entry('三', '2026-11-01'),
    ];
    await render(tester, notices);
    await tester.drag(
      find.byType(PageView),
      Offset(-tester.getSize(find.byType(PageView)).width * .8, 0),
    );
    await tester.pumpAndSettle();
    expect(find.text('2/3'), findsOneWidget);
    await tester.tap(find.byTooltip('下一条紧急 DDL'));
    await tester.pumpAndSettle();
    await render(tester, notices.take(2).toList());
    expect(find.text('2/2'), findsOneWidget);
    expect(find.text('二').hitTestable(), findsOneWidget);
    await render(tester, [notices.first]);
    expect(find.byTooltip('下一条紧急 DDL'), findsNothing);
    expect(find.text('一').hitTestable(), findsOneWidget);
    await render(tester, []);
    expect(find.byType(PageView), findsNothing);
    await render(tester, notices);
    expect(find.text('1/3'), findsOneWidget);
  });
  testWidgets('旋转和桌面切换后保留当前通知，长来源不遮挡截止时间', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final notices = [entry('一', '2026-10-30'), entry('二', '2026-10-31')];
    await render(tester, notices);
    await tester.tap(find.byTooltip('下一条紧急 DDL'));
    await tester.pumpAndSettle();
    await render(tester, notices, width: 800);
    expect(find.text('2/2'), findsOneWidget);
    expect(find.text('二').hitTestable(), findsOneWidget);
    await render(tester, notices, width: 1200);
    expect(find.text('紧急 DDL'), findsOneWidget);
    await render(tester, notices, width: 390);
    expect(find.text('2/2'), findsOneWidget);
    expect(find.text('二').hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('窄屏与两倍字体下保留可操作翻页及完整截止信息', (tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final notices = [
      entry('一', '2026-10-30', title: '非常长的通知标题用于验证手机截断与可访问名称'),
      entry('二', '2026-10-31'),
    ];
    for (final width in [320.0, 390.0]) {
      await render(tester, notices, width: width, scale: 2);
      expect(tester.takeException(), isNull);
      expect(find.text('今天截止').hitTestable(), findsOneWidget);
      expect(
        tester
            .getSize(
              find.byWidgetPredicate(
                (widget) =>
                    widget is IconButton && widget.tooltip == '下一条紧急 DDL',
              ),
            )
            .width,
        greaterThanOrEqualTo(48),
      );
      await tester.tap(find.byTooltip('下一条紧急 DDL'));
      await tester.pumpAndSettle();
      expect(find.text('2/2'), findsOneWidget);
      expect(find.text('剩 1 天').hitTestable(), findsOneWidget);
      await tester.tap(find.byTooltip('上一条紧急 DDL'));
      await tester.pumpAndSettle();
    }
  });
}
