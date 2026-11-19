import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:notifai_mobile/data/account_api.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/state/account.dart';
import 'package:notifai_mobile/state/user_settings.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const accountJson = {'id': id, 'username': 'tester', 'displayName': 'Tester'};

http.Response snapshot(int revision, UserPreferences? settings) =>
    http.Response(
      jsonEncode({
        'schemaVersion': 1,
        'revision': revision,
        'settings': settings == null ? null : projectCloudSettings(settings),
      }),
      200,
      headers: {'etag': '"$revision"', 'content-type': 'application/json; charset=utf-8'},
    );

Future<void> waitFor(
  AccountController account,
  bool Function() condition,
) async {
  if (condition()) return;
  final observed = Completer<void>();
  void listener() {
    if (condition() && !observed.isCompleted) observed.complete();
  }

  account.addListener(listener);
  try {
    await observed.future.timeout(
      const Duration(seconds: 3),
      onTimeout: () => fail('最后观测到 ${account.status}：${account.notice}'),
    );
  } finally {
    account.removeListener(listener);
  }
}

void main() {
  late LocalStore store;
  late UserSettings settings;
  late AccountController account;
  late AccountSession? session;
  late FutureOr<http.Response> Function(http.Request) handle;

  setUp(() async {
    sqfliteFfiInit();
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = UserSettings(store);
    await settings.initialize();
    session = null;
    account = AccountController(
      api: AccountApi(
        baseUrl: 'https://api.notifai.top/api',
        webBaseUrl: 'https://notifai.top',
        client: MockClient((request) async => handle(request)),
      ),
      settings: settings,
      readSession: () async => session,
      writeSession: (value) async => session = value,
      openWeb: () async {},
    );
  });

  tearDown(() async {
    account.dispose();
    settings.dispose();
    await store.close();
  });

  test('saved login hides guest preferences before verification and through cloud failure', () async {
    await settings.toggleImportant('guest-important');
    session = (userId: id, token: token);
    final auth = Completer<http.Response>();
    handle = (request) => request.url.path.endsWith('/session')
        ? auth.future
        : http.Response('{"detail":"ACCOUNT_STORAGE_UNAVAILABLE"}', 503);
    await account.initialize();
    expect(settings.accountMode, isTrue);
    expect(settings.value.importantIds, isEmpty);
    await expectLater(
      settings.toggleImportant('wrong-profile'),
      throwsStateError,
    );
    auth.complete(http.Response(jsonEncode(accountJson), 200));
    await waitFor(
      account,
      () => account.status == AccountStatus.unavailable && !account.busy,
    );
    expect(account.user?.id, id);
    expect(settings.value.importantIds, isEmpty);
    final guest = await store.read(settingsStorageKey) as Map;
    expect(guest['importantIds'], ['guest-important']);
  });

  test('explicit guest import projects only cloud fields; logout restores guest', () async {
    await settings.toggleImportant('guest-important');
    await settings.markRead('guest-read');
    await settings.setTheme('dark');
    final written = <Map<String, dynamic>>[];
    handle = (request) {
      if (request.url.path.endsWith('/login')) {
        return http.Response(
          jsonEncode(accountJson),
          200,
          headers: {
            'set-cookie':
                'notifai_session=$token; Path=/api; HttpOnly; Secure; SameSite=Lax',
          },
        );
      }
      if (request.url.path.endsWith('/logout')) return http.Response('', 204);
      if (request.method == 'PUT') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        final cloud = body['settings'] as Map<String, dynamic>;
        written.add(cloud);
        return snapshot(1, UserPreferences.fromJson(cloud));
      }
      return snapshot(0, null);
    };
    await account.signIn('tester', 'temporary password');
    expect(account.hasImportCandidate, isTrue);
    expect(settings.value.importantIds, isEmpty);
    expect(settings.value.readIds, isEmpty);
    expect(settings.value.darkMode, 'auto');
    await settings.markRead('account-read');
    expect(account.hasUnsynced, isFalse);
    await account.importLocal();
    expect(account.status, AccountStatus.synced);
    expect(written.single['importantIds'], ['guest-important']);
    expect(written.single, isNot(contains('readIds')));
    expect(written.single, isNot(contains('darkMode')));
    expect(settings.value.readIds, ['account-read']);
    await account.signOut();
    expect(session, isNull);
    expect(settings.value.readIds, ['guest-read']);
    expect(settings.value.importantIds, ['guest-important']);
    expect(settings.value.darkMode, 'dark');
  });

  test(
    'conflict never auto-overwrites; explicit overwrite uses observed revision',
    () async {
      final writes = <String?>[];
      final initial = UserPreferences.defaults();
      final remote = initial.copyWith(importantIds: ['remote']);
      var revision = 1;
      handle = (request) {
        if (request.url.path.endsWith('/session')) {
          return http.Response(jsonEncode(accountJson), 200);
        }
        if (request.method != 'PUT') {
          return snapshot(revision, revision == 1 ? initial : remote);
        }
        writes.add(request.headers['If-Match']);
        if (revision == 1) {
          revision = 2;
          return http.Response('{"detail":"REVISION_CONFLICT"}', 412);
        }
        return snapshot(
          3,
          UserPreferences.fromJson(
            (jsonDecode(request.body) as Map)['settings'],
          ),
        );
      };
      session = (userId: id, token: token);
      await account.restore();
      expect(account.status, AccountStatus.synced, reason: account.notice);
      await settings.toggleImportant('local');
      await waitFor(
        account,
        () => account.status == AccountStatus.conflict && !account.busy,
      );
      expect(writes, ['"1"']);
      expect(account.canOverwrite, isTrue);
      expect(settings.value.importantIds, ['local']);
      await account.overwriteCloud();
      expect(writes, ['"1"', '"2"']);
      expect(account.status, AccountStatus.synced);
    },
  );

  test('retry after a lost write response checks the revision even when the draft reverted', () async {
    final initial = UserPreferences.defaults();
    var revision = 1;
    var writes = 0;
    handle = (request) {
      if (request.url.path.endsWith('/session')) {
        return http.Response(jsonEncode(accountJson), 200);
      }
      if (request.method != 'PUT') {
        return snapshot(
          revision,
          revision == 1 ? initial : initial.copyWith(importantIds: ['local']),
        );
      }
      if (++writes == 1) {
        revision++;
        throw http.ClientException('Lost response after server commit');
      }
      return http.Response('{"detail":"REVISION_CONFLICT"}', 412);
    };
    session = (userId: id, token: token);
    await account.restore();
    await settings.toggleImportant('local');
    await waitFor(account, () => account.status == AccountStatus.dirty && !account.busy);
    await settings.toggleImportant('local');
    expect(settings.value.importantIds, isEmpty);
    await account.retrySave();
    expect(writes, 2);
    expect(account.status, AccountStatus.conflict);
  });
}
