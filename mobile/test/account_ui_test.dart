import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/data/account_api.dart';
import 'package:notifai_mobile/features/account.dart';
import 'package:notifai_mobile/state/account.dart';

class _GuestAccount extends ChangeNotifier implements AccountController {
  final attempt = Completer<void>();
  int webOpens = 0;
  int loginAttempts = 0;

  @override
  AccountUser? get user => null;

  @override
  AccountStatus get status => AccountStatus.guest;

  @override
  bool get busy => false;

  @override
  String? get notice => null;

  @override
  Future<AccountCapabilities> getCapabilities() async =>
      const AccountCapabilities(hasOidc: true);

  @override
  Future<void> openWebAccount() async {
    webOpens++;
  }

  @override
  Future<void> signIn(String username, String password) {
    loginAttempts++;
    return attempt.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ConflictedAccount extends _GuestAccount {
  @override
  AccountUser get user => const AccountUser(
    id: 'account',
    username: 'student',
    displayName: 'Student',
  );

  @override
  AccountStatus get status => AccountStatus.conflict;

  @override
  bool canOverwrite = false;

  @override
  bool get hasUnsynced => true;

  @override
  bool get hasImportCandidate => false;

  int overwrites = 0;
  int signOuts = 0;

  @override
  Future<void> refreshConflict() async {
    canOverwrite = true;
    notifyListeners();
  }

  @override
  Future<void> overwriteCloud() async {
    overwrites++;
  }

  @override
  Future<void> signOut() async {
    signOuts++;
  }
}

void main() {
  testWidgets(
    'small, large-text login keeps errors local and protects busy back',
    (tester) async {
      final account = _GuestAccount();
      addTearDown(account.dispose);
      await tester.binding.setSurfaceSize(const Size(375, 480));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(2)),
            child: child!,
          ),
          home: Scaffold(
            body: ListView(children: [AccountPanel(account: account)]),
          ),
        ),
      );
      await tester.tap(find.text('登录 NotifAI'));
      await tester.pumpAndSettle();

      final dialog = find.byType(AlertDialog);
      expect(find.byType(AutofillGroup), findsOneWidget);
      expect(find.byTooltip('显示密码'), findsOneWidget);
      final web = find.text('在浏览器打开网页版');
      await tester.ensureVisible(web);
      expect(find.textContaining('网页版登录不会登录本应用'), findsOneWidget);
      await tester.tap(web);
      await tester.pumpAndSettle();
      expect(account.webOpens, 1);
      expect(account.loginAttempts, 0);
      expect(dialog, findsOneWidget);

      final fields = find.byType(TextFormField);
      await tester.ensureVisible(fields.first);
      await tester.enterText(fields.first, 'student');
      await tester.ensureVisible(fields.last);
      await tester.enterText(fields.last, 'wrong');
      final submit = find.text('登录');
      await tester.ensureVisible(submit);
      await tester.tap(submit);
      await tester.pump();
      expect(account.loginAttempts, 1);
      await tester.binding.handlePopRoute();
      await tester.pump();
      expect(dialog, findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, '登录'))
            .onPressed,
        isNull,
      );

      account.attempt.completeError(
        const AccountApiException('INVALID_CREDENTIALS'),
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(of: dialog, matching: find.text('用户名或密码不正确')),
        findsOneWidget,
      );
      expect(
        tester.widget<TextFormField>(fields.last).controller!.text,
        isEmpty,
      );
      expect(tester.takeException(), isNull);

      final cancel = find.text('取消');
      await tester.ensureVisible(cancel);
      await tester.tap(cancel);
      await tester.pumpAndSettle();
      expect(dialog, findsNothing);
    },
  );

  testWidgets('cloud overwrite requires readable revision and confirmation', (
    tester,
  ) async {
    final account = _ConflictedAccount();
    addTearDown(account.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: AccountPanel(account: account)),
      ),
    );
    final overwrite = find.widgetWithText(OutlinedButton, '用本机版本覆盖');
    expect(tester.widget<OutlinedButton>(overwrite).onPressed, isNull);
    expect(find.text('使用云端版本'), findsOneWidget);
    await tester.tap(find.text('重试读取云端版本'));
    await tester.pumpAndSettle();
    expect(tester.widget<OutlinedButton>(overwrite).onPressed, isNotNull);

    await tester.tap(overwrite);
    await tester.pumpAndSettle();
    expect(find.text('覆盖云端设置？'), findsOneWidget);
    expect(account.overwrites, 0);
    await tester.tap(find.text('确认覆盖'));
    await tester.pumpAndSettle();
    expect(account.overwrites, 1);

    await tester.tap(find.text('退出登录'));
    await tester.pumpAndSettle();
    expect(find.text('尚未同步的修改可能丢失。'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(account.signOuts, 0);
  });
}
