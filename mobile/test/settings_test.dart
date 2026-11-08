import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:notifai_mobile/data/local_store.dart';
import 'package:notifai_mobile/state/user_settings.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  sqfliteFfiInit();

  late LocalStore store;
  late UserSettings settings;

  setUp(() async {
    store = await LocalStore.open(
      path: inMemoryDatabasePath,
      factory: databaseFactoryFfi,
    );
    settings = UserSettings(store);
    await settings.initialize();
  });

  tearDown(() async {
    settings.dispose();
    await store.close();
  });

  Future<void> rejectWritesFor(String key) => store.database.execute('''
    CREATE TRIGGER reject_settings_write BEFORE INSERT ON kv
    WHEN NEW.key = '$key'
    BEGIN SELECT RAISE(ABORT, 'durable write denied'); END
  ''');

  UserPreferences preferencesAtBackupBytes(int byteCount) {
    final map = UserPreferences.defaults().toJson();
    map['exportedAt'] = '2026-10-30T00:00:00.000Z';
    var remaining = byteCount - utf8.encode(jsonEncode(map)).length;
    final keywords = <String>[];
    void append(String keyword) {
      remaining -=
          utf8.encode(jsonEncode(keyword)).length + (keywords.isEmpty ? 0 : 1);
      keywords.add(keyword);
    }

    while (remaining > 610) {
      final prefix = '${keywords.length}:';
      append(prefix + '界' * (200 - prefix.length));
    }
    if (remaining > 580) append('${keywords.length}:${'a' * 30}');
    final prefix = '${keywords.length}:';
    final contentBytes =
        remaining - (keywords.isEmpty ? 0 : 1) - 2 - prefix.length;
    append(prefix + '界' * (contentBytes ~/ 3) + 'a' * (contentBytes % 3));
    expect(remaining, 0);
    expect(keywords.length, lessThanOrEqualTo(10000));
    expect(keywords.every((keyword) => keyword.length <= 200), isTrue);
    map['blacklistKeywords'] = keywords;
    expect(utf8.encode(jsonEncode(map)), hasLength(byteCount));
    return UserPreferences.fromJson(map);
  }

  test('source limits count normalized unique names and reject replacement without writes', () async {
    final allowed = [
      ...List.generate(99, (index) => '来源-$index'),
      ' 计算机科学与技术学院 ',
      '计算机学院',
    ];
    await settings.importBackup(jsonEncode({'subscribedDepts': allowed}));
    expect(settings.value.subscribedDepts, hasLength(100));
    expect(settings.value.subscribedDepts.last, '计算机学院');
    final before = settings.value.toJson();
    final excessive = [...allowed, '第101个独立来源'];
    var notifications = 0;
    settings.addListener(() => notifications++);
    expect(
      () => UserPreferences.fromJson({
        'subscribedDepts': excessive,
      }, importing: true),
      throwsA(isA<FormatException>()),
    );
    await expectLater(
      settings.importBackup(jsonEncode({'subscribedDepts': excessive})),
      throwsA(isA<FormatException>()),
    );
    await expectLater(
      settings.update(settings.value.copyWith(subscribedDepts: excessive)),
      throwsA(isA<FormatException>()),
    );
    await expectLater(
      settings.completeOnboarding(
        identity: 'custom',
        sources: excessive,
        categories: [],
        keywords: [],
      ),
      throwsA(isA<FormatException>()),
    );
    expect(settings.value.toJson(), before);
    expect(await store.read(settingsStorageKey), before);
    expect(await store.read(onboardingFlagStorageKey), isNull);
    expect(settings.error, contains('100'));
    expect(notifications, 0);
    await settings.update(settings.value.copyWith(subscribedDepts: allowed));
    expect(settings.value.subscribedDepts, hasLength(100));
  });

  test(
    'legacy persisted source aliases normalize and deduplicate on load',
    () async {
      await store.write(settingsStorageKey, {
        'schemaVersion': 2,
        'subscriptionMode': 'custom',
        'subscribedDepts': ['招生办公室', '本科招生网', '国际合作与交流部'],
      });
      final loaded = UserSettings(store);
      try {
        await loaded.initialize();
        expect(loaded.value.subscribedDepts, ['本科招生网', '国际合作交流']);
      } finally {
        loaded.dispose();
      }
    },
  );

  test('legacy local source lists remain intact until an explicit valid replacement', () async {
    final sources = List.generate(103, (index) => '旧来源-$index');
    await store.write(settingsStorageKey, {
      'schemaVersion': 2,
      'subscribedDepts': sources,
      'starredIds': ['legacy-favorite'],
    });
    final loaded = UserSettings(store);
    try {
      await loaded.initialize();
      expect(loaded.value.subscribedDepts, sources);
      expect(loaded.value.starredIds, ['legacy-favorite']);
      final migrated = await store.read(settingsStorageKey) as Map;
      expect(migrated['subscribedDepts'], sources);
      expect(migrated['schemaVersion'], 3);
      await expectLater(
        loaded.setTheme('dark'),
        throwsA(isA<FormatException>()),
      );
      expect(await store.read(settingsStorageKey), migrated);
      await loaded.update(
        loaded.value.copyWith(subscribedDepts: sources.take(100).toList()),
      );
      expect(loaded.value.subscribedDepts, sources.take(100).toList());
      expect(loaded.value.starredIds, ['legacy-favorite']);
    } finally {
      loaded.dispose();
    }
  });

  test('a compact backup at the UTF8 byte limit exports and reimports without growth', () async {
    final boundary = preferencesAtBackupBytes(maxPreferenceBytes);
    await settings.update(boundary);
    final compact = settings.exportBackup();
    expect(utf8.encode(compact), hasLength(maxPreferenceBytes));
    expect(compact.length, lessThan(maxPreferenceBytes));
    expect(compact, jsonEncode(jsonDecode(compact)));
    expect(
      utf8
          .encode(
            const JsonEncoder.withIndent('  ').convert(jsonDecode(compact)),
          )
          .length,
      greaterThan(maxPreferenceBytes),
    );
    await settings.importBackup(compact);
    expect(settings.value.toJson(), boundary.toJson());
    expect(await store.read(settingsStorageKey), boundary.toJson());
    final roundTrip = settings.exportBackup();
    expect(utf8.encode(roundTrip), hasLength(maxPreferenceBytes));
    expect(
      UserPreferences.fromJson(jsonDecode(roundTrip), importing: true).toJson(),
      boundary.toJson(),
    );
    var notifications = 0;
    settings.addListener(() => notifications++);
    await expectLater(
      settings.addTag('notice', '超限'),
      throwsA(isA<FormatException>()),
    );
    await expectLater(
      settings.importBackup(' $compact'),
      throwsA(isA<FormatException>()),
    );
    expect(settings.value.toJson(), boundary.toJson());
    expect(await store.read(settingsStorageKey), boundary.toJson());
    expect(notifications, 0);
  });

  test('one byte beyond the export envelope limit rejects update before durable mutation', () async {
    await settings.favorite('retained', 'research');
    final before = settings.value.toJson();
    final oversized = preferencesAtBackupBytes(maxPreferenceBytes + 1);
    // The persisted payload alone fits, but its recoverable backup must fit too.
    expect(
      utf8.encode(jsonEncode(oversized.toJson())).length,
      lessThan(maxPreferenceBytes),
    );
    var notifications = 0;
    settings.addListener(() => notifications++);
    await expectLater(
      settings.update(oversized),
      throwsA(isA<FormatException>()),
    );
    final oversizedSnapshot = oversized.copyWith(
      customTags: {
        'extra': ['界' * 50],
      },
    );
    expect(
      utf8.encode(jsonEncode(oversizedSnapshot.toJson())).length,
      greaterThan(maxPreferenceBytes),
    );
    await expectLater(
      settings.update(oversizedSnapshot),
      throwsA(isA<FormatException>()),
    );
    await expectLater(
      settings.importBackup(jsonEncode(oversizedSnapshot.toJson())),
      throwsA(isA<FormatException>()),
    );
    expect(settings.value.toJson(), before);
    expect(await store.read(settingsStorageKey), before);
    expect(settings.error, contains('5 MiB'));
    expect(notifications, 0);
  });

  test('oversized legacy migration retains user facts and raw local data without writing', () async {
    final oversized = preferencesAtBackupBytes(maxPreferenceBytes + 1);
    final legacy = {...oversized.toJson(), 'schemaVersion': 2};
    await store.write(settingsStorageKey, legacy);
    final loaded = UserSettings(store);
    try {
      await loaded.initialize();
      expect(loaded.value.toJson(), oversized.toJson());
      expect(loaded.error, contains('5 MiB'));
      expect(await store.read(settingsStorageKey), legacy);
      expect(loaded.exportBackup, throwsA(isA<FormatException>()));
    } finally {
      loaded.dispose();
    }
  });

  test('default folders and all nested preference snapshots are immutable', () {
    expect(settings.value.folders.map((folder) => folder.id), [
      'default',
      'course',
      'competition',
      'research',
      'campus',
    ]);
    final ids = ['first'];
    final tags = ['标签'];
    final map = <String, List<String>>{'first': tags};
    final folders = [...defaultFolders];
    final snapshot = settings.value.copyWith(
      starredIds: ids,
      customTags: map,
      folders: folders,
    );
    ids.add('second');
    tags.add('改写');
    map['second'] = [];
    folders.clear();
    expect(snapshot.starredIds, ['first']);
    expect(snapshot.customTags, {
      'first': ['标签'],
    });
    expect(snapshot.folders, hasLength(5));
    expect(() => snapshot.starredIds.add('third'), throwsUnsupportedError);
    expect(
      () => snapshot.starredFolderMap['first'] = 'course',
      throwsUnsupportedError,
    );
    expect(
      () => snapshot.customTags['first']!.add('不可改写'),
      throwsUnsupportedError,
    );
    expect(() => snapshot.customTags['second'] = [], throwsUnsupportedError);
    expect(() => snapshot.folders.clear(), throwsUnsupportedError);
    final json = snapshot.toJson();
    (json['starredIds'] as List).clear();
    ((json['customTags'] as Map)['first'] as List).clear();
    expect(snapshot.starredIds, ['first']);
    expect(snapshot.customTags['first'], ['标签']);
  });

  test(
    'legacy backup normalizes Web aliases, IDs, folders and category order',
    () async {
      await settings.importBackup(
        jsonEncode({
          'subscribedDepts': [' 计算机科学与技术学院 ', '计算机学院', '新的真实来源'],
          'subscribedCategories': ['research', 'exam', 'exam', 'unknown'],
          'starredIds': ['notice-1', 'constructor', '../invalid', 'notice-1'],
          'starredFolderMap': {'notice-1': 'missing', 'constructor': 'custom'},
          'customTags': {
            'notice-1': [' 竞赛 ', '竞赛', 42],
            'constructor': ['安全'],
          },
          'folders': [
            {
              'id': 'custom',
              'name': ' 自定义 ',
              'icon': 'mdi-star',
              'createdAt': 2,
            },
          ],
        }),
      );
      expect(settings.value.schemaVersion, 3);
      expect(settings.value.subscriptionMode, 'custom');
      expect(settings.value.subscribedDepts, ['计算机学院', '新的真实来源']);
      expect(settings.value.categoryMode, 'custom');
      expect(settings.value.subscribedCategories, ['exam', 'research']);
      expect(settings.value.starredIds, ['notice-1', 'constructor']);
      expect(settings.value.starredFolderMap, {
        'notice-1': 'default',
        'constructor': 'custom',
      });
      expect(settings.value.customTags, {
        'notice-1': ['竞赛'],
        'constructor': ['安全'],
      });
      expect(settings.value.folders.map((folder) => folder.id), [
        'default',
        'custom',
      ]);
      expect(settings.value.folders.last.icon, r'$star');
      expect(settings.value.folders.last.name, '自定义');
      final persisted = await store.read(settingsStorageKey) as Map;
      expect(persisted['schemaVersion'], 3);
    },
  );

  test('v1 and v2 local preferences migrate durably without clearing independent flags', () async {
    for (final version in [1, 2]) {
      await store.writeAll({
        settingsStorageKey: {
          'schemaVersion': version,
          'subscribedDepts': ['教务处'],
          'starredIds': ['old-notice'],
          'pinnedIds': ['pin-only'],
          'importantIds': ['important-only'],
        },
        onboardingFlagStorageKey: 'true',
        onboardingIdentityStorageKey: 'postgraduate',
      });
      final loaded = UserSettings(store);
      await loaded.initialize();
      expect(loaded.value.subscribedDepts, ['教务处']);
      expect(loaded.value.categoryMode, 'all');
      expect(loaded.value.subscribedCategories, isEmpty);
      expect(loaded.value.starredIds, ['old-notice']);
      expect(loaded.value.pinnedIds, ['pin-only']);
      expect(loaded.value.importantIds, ['important-only']);
      expect(loaded.onboarded, isTrue);
      expect(loaded.identity, 'postgraduate');
      expect((await store.read(settingsStorageKey) as Map)['schemaVersion'], 3);
      loaded.dispose();
    }
  });

  test(
    'v3 export round-trips and import replaces rather than merges user assets',
    () async {
      await settings.completeOnboarding(
        identity: 'postgraduate',
        sources: ['教务处'],
        categories: ['research'],
        keywords: ['旧关键词'],
      );
      await settings.favorite('old-favorite', 'course');
      await settings.markRead('old-read');
      await settings.togglePin('old-pin');
      await settings.toggleImportant('old-important');
      await settings.addTag('old-tag', '旧标签');
      final imported = UserPreferences.defaults().copyWith(
        subscriptionMode: 'custom',
        subscribedDepts: ['新的来源'],
        categoryMode: 'custom',
        subscribedCategories: ['competition'],
        blacklistKeywords: ['新关键词'],
        starredIds: ['new-favorite'],
        starredFolderMap: {'new-favorite': 'research'},
        readIds: ['new-read'],
        pinnedIds: ['new-pin'],
        importantIds: ['new-important'],
        customTags: {
          'new-tag': ['新标签'],
        },
        darkMode: 'dark',
        notificationEnabled: true,
      );
      await settings.importBackup(
        jsonEncode({
          ...imported.toJson(),
          'exportedAt': '2026-10-30T00:00:00.000Z',
        }),
      );
      expect(settings.value.toJson(), imported.toJson());
      expect(await store.read(settingsStorageKey), imported.toJson());
      expect(settings.onboarded, isTrue);
      expect(settings.identity, 'postgraduate');
      final exported =
          jsonDecode(settings.exportBackup()) as Map<String, dynamic>;
      expect(exported['schemaVersion'], 3);
      expect(DateTime.tryParse(exported['exportedAt'] as String), isNotNull);
      expect(exported.containsKey('syncClock'), isFalse);
      expect(exported.containsKey('syncWriter'), isFalse);
      expect(
        UserPreferences.fromJson(exported, importing: true).toJson(),
        imported.toJson(),
      );
      final reloaded = UserSettings(store);
      await reloaded.initialize();
      expect(reloaded.value.toJson(), imported.toJson());
      reloaded.dispose();
    },
  );

  test(
    'invalid and future imports never modify preferences, disk or onboarding',
    () async {
      await settings.completeOnboarding(
        identity: 'undergraduate',
        sources: ['教务处'],
        categories: ['exam'],
        keywords: ['保留'],
      );
      await settings.favorite('keep', 'course');
      final before = settings.value.toJson();
      final persisted = await store.read(settingsStorageKey);
      var notifications = 0;
      settings.addListener(() => notifications++);
      for (final bad in [
        '{broken',
        'null',
        '[]',
        '42',
        '{}',
        '{"unrelated": true}',
        '{"schemaVersion": 0, "starredIds": []}',
        '{"schemaVersion": "3", "starredIds": []}',
        '{"schemaVersion": 2.5, "starredIds": []}',
        '{"schemaVersion": 4, "starredIds": []}',
        '{"starredIds": "not-an-array"}',
        '{"customTags": []}',
        '{"darkMode": "invalid"}',
        '{"notificationEnabled": "true"}',
      ]) {
        await expectLater(
          settings.importBackup(bad),
          throwsA(isA<FormatException>()),
        );
        expect(settings.value.toJson(), before);
        expect(await store.read(settingsStorageKey), persisted);
        expect(settings.onboarded, isTrue);
        expect(settings.identity, 'undergraduate');
        expect(settings.error, isNotNull);
        expect(settings.readOnly, isFalse);
      }
      expect(notifications, 0);
      await settings.markRead('still-writable');
      expect(settings.value.readIds, ['still-writable']);
      expect(notifications, 1);
      expect(settings.error, isNull);
    },
  );

  test('real SQLite abort rejects an import without changing durable or visible state', () async {
    await settings.favorite('keep', 'research');
    final before = settings.value.toJson();
    var notifications = 0;
    settings.addListener(() => notifications++);
    await rejectWritesFor(settingsStorageKey);
    await expectLater(
      settings.importBackup(
        jsonEncode({
          'schemaVersion': 3,
          'starredIds': ['replace'],
        }),
      ),
      throwsA(isA<DatabaseException>()),
    );
    expect(settings.value.toJson(), before);
    expect(await store.read(settingsStorageKey), before);
    expect(notifications, 0);
    expect(settings.error, isNotNull);
    await store.database.execute('DROP TRIGGER reject_settings_write');
    await settings.setTheme('dark');
    expect(settings.value.darkMode, 'dark');
    expect(notifications, 1);
  });

  test('onboarding transaction rolls back preferences and flags on a late SQLite failure', () async {
    await settings.favorite('retained', 'course');
    final before = settings.value.toJson();
    var notifications = 0;
    settings.addListener(() => notifications++);
    await rejectWritesFor(onboardingIdentityStorageKey);
    await expectLater(
      settings.completeOnboarding(
        identity: 'postgraduate',
        sources: ['教务处'],
        categories: ['research'],
        keywords: ['新关键词'],
      ),
      throwsA(isA<DatabaseException>()),
    );
    expect(settings.value.toJson(), before);
    expect(settings.onboarded, isFalse);
    expect(settings.identity, 'freshman');
    expect(await store.read(settingsStorageKey), before);
    expect(await store.read(onboardingFlagStorageKey), isNull);
    expect(await store.read(onboardingIdentityStorageKey), isNull);
    expect(await store.read('notifai_subscribed_channels'), isNull);
    expect(notifications, 0);
  });

  test(
    'only durably committed snapshots notify while SQLite is blocked',
    () async {
      final started = Completer<void>();
      final release = Completer<void>();
      final lock = store.database.transaction((transaction) async {
        await transaction.rawQuery('SELECT 1');
        started.complete();
        await release.future;
      });
      await started.future;
      var notifications = 0;
      final observedDisk = <Future<Object?>>[];
      settings.addListener(() {
        notifications++;
        observedDisk.add(store.read(settingsStorageKey));
        expect(settings.value.starredIds, ['durable']);
      });
      final mutation = settings.favorite('durable', 'default');
      await Future<void>.delayed(Duration.zero);
      expect(settings.value.starredIds, isEmpty);
      expect(notifications, 0);
      release.complete();
      await lock;
      await mutation;
      expect(notifications, 1);
      expect(await observedDisk.single, settings.value.toJson());
    },
  );

  test('local future schema is readonly and raw unknown facts survive every mutation', () async {
    final future = {
      'schemaVersion': 99,
      'darkMode': 'dark',
      'starredIds': ['future-notice'],
      'futureSetting': {
        'enabled': true,
        'nested': [1, 2, 3],
      },
    };
    await store.write(settingsStorageKey, future);
    final loaded = UserSettings(store);
    await loaded.initialize();
    expect(loaded.readOnly, isTrue);
    expect(loaded.error, contains('只读'));
    expect(loaded.value.starredIds, ['future-notice']);
    expect(jsonDecode(loaded.exportBackup()), future);
    var notifications = 0;
    loaded.addListener(() => notifications++);
    final mutations = <Future<void> Function()>[
      () => loaded.update(UserPreferences.defaults()),
      () => loaded.setTheme('light'),
      () => loaded.favorite('new', 'default'),
      () => loaded.unfavorite('future-notice'),
      () => loaded.markRead('future-notice'),
      () => loaded.clearRead(),
      () => loaded.togglePin('future-notice'),
      () => loaded.toggleImportant('future-notice'),
      () => loaded.addTag('future-notice', '标签'),
      () => loaded.removeTag('future-notice', '标签'),
      () => loaded.createFolder('新的'),
      () => loaded.renameFolder('default', '新的'),
      () => loaded.deleteFolder('course'),
      () => loaded.resetOnboarding(),
      () => loaded.completeOnboarding(
        identity: 'custom',
        sources: [],
        categories: [],
        keywords: [],
      ),
      () => loaded.importBackup('{"starredIds": []}'),
    ];
    for (final mutate in mutations) {
      await expectLater(mutate(), throwsStateError);
      expect(await store.read(settingsStorageKey), future);
    }
    expect(notifications, 0);
    expect(await store.read(onboardingFlagStorageKey), isNull);
    loaded.dispose();
  });

  test('a future schema discovered immediately before writing cannot be overwritten', () async {
    final future = {
      'schemaVersion': 4,
      'future': 'preserve',
      'darkMode': 'dark',
    };
    await store.write(settingsStorageKey, future);
    await expectLater(settings.setTheme('light'), throwsStateError);
    expect(settings.readOnly, isTrue);
    expect(await store.read(settingsStorageKey), future);
    expect(jsonDecode(settings.exportBackup()), future);
  });

  test('corrupt local data uses explicit safe defaults without an automatic overwrite', () async {
    for (final corrupt in [
      '{broken',
      ['not-an-object'],
      {'schemaVersion': -1},
    ]) {
      await store.write(settingsStorageKey, corrupt);
      final loaded = UserSettings(store);
      await loaded.initialize();
      expect(loaded.value.toJson(), UserPreferences.defaults().toJson());
      expect(loaded.error, contains('安全默认值'));
      expect(loaded.readOnly, isFalse);
      expect(await store.read(settingsStorageKey), corrupt);
      loaded.dispose();
    }
    await store.write(settingsStorageKey, '{broken');
    final recovered = UserSettings(store);
    await recovered.initialize();
    await recovered.importBackup('{"starredIds": ["recovered"]}');
    expect(recovered.value.starredIds, ['recovered']);
    expect((await store.read(settingsStorageKey) as Map)['starredIds'], [
      'recovered',
    ]);
    recovered.dispose();
  });

  test(
    'favorite, read, pin, important and custom tags remain independent',
    () async {
      await Future.wait([
        settings.favorite('notice', 'course'),
        settings.markRead('notice'),
        settings.togglePin('notice'),
        settings.toggleImportant('notice'),
        settings.addTag('notice', '标签'),
      ]);
      await settings.unfavorite('notice');
      expect(settings.value.starredIds, isEmpty);
      expect(settings.value.starredFolderMap, isEmpty);
      expect(settings.value.readIds, contains('notice'));
      expect(settings.value.pinnedIds, contains('notice'));
      expect(settings.value.importantIds, contains('notice'));
      expect(settings.value.customTags['notice'], ['标签']);
      await settings.clearRead();
      await settings.togglePin('notice');
      expect(settings.value.readIds, isEmpty);
      expect(settings.value.pinnedIds, isEmpty);
      expect(settings.value.importantIds, contains('notice'));
      expect(settings.value.customTags['notice'], ['标签']);
      expect(await store.read(settingsStorageKey), settings.value.toJson());
    },
  );

  test('folder CRUD protects default and moves references without removing favorites', () async {
    await settings.createFolder(' 项目 ', icon: 'mdi-flask');
    final folder = settings.value.folders.last;
    expect(folder.name, '项目');
    expect(folder.icon, r'$flask');
    expect(folder.createdAt, greaterThan(0));
    await settings.favorite('first', folder.id);
    await settings.favorite('second', 'missing');
    expect(settings.value.starredFolderMap['second'], 'default');
    await settings.renameFolder(folder.id, ' 改名 ');
    expect(settings.value.folders.last.name, '改名');
    await expectLater(
      settings.deleteFolder('default'),
      throwsA(isA<FormatException>()),
    );
    await settings.deleteFolder(folder.id);
    expect(settings.value.folders.any((item) => item.id == folder.id), isFalse);
    expect(settings.value.starredIds, ['first', 'second']);
    expect(settings.value.starredFolderMap, {
      'first': 'default',
      'second': 'default',
    });
    expect(await store.read(settingsStorageKey), settings.value.toJson());
  });

  test('tag limits reject excess losslessly, deduplicate and remove empty mappings', () async {
    final tags = List.generate(50, (index) => 'tag-$index');
    await settings.update(
      settings.value.copyWith(customTags: {'notice': tags}),
    );
    final before = settings.value.toJson();
    await expectLater(settings.addTag('notice', '第51个'), throwsStateError);
    await expectLater(
      settings.addTag('notice', 'a' * 51),
      throwsA(isA<FormatException>()),
    );
    expect(settings.value.toJson(), before);
    expect(await store.read(settingsStorageKey), before);
    await settings.addTag('notice', ' tag-0 ');
    expect(settings.value.customTags['notice'], hasLength(50));
    await settings.removeTag('notice', 'tag-0');
    await settings.addTag('notice', ' 新标签 ');
    expect(settings.value.customTags['notice']!.last, '新标签');
    await settings.addTag('single', '唯一');
    await settings.removeTag('single', '唯一');
    expect(settings.value.customTags.containsKey('single'), isFalse);
  });

  test('read history retains newest 10000 and loaded read never marks unrelated notices', () async {
    final ids = List.generate(10000, (index) => 'notice-$index');
    await settings.update(settings.value.copyWith(readIds: ids));
    await settings.markLoadedRead(['notice-9999', 'loaded-a', 'loaded-b']);
    expect(settings.value.readIds, hasLength(10000));
    expect(settings.value.readIds.first, 'notice-2');
    expect(settings.value.readIds.sublist(9998), ['loaded-a', 'loaded-b']);
    expect(settings.value.readIds, isNot(contains('not-loaded')));
    expect(settings.value.starredIds, isEmpty);
  });

  test('reset onboarding clears only its managed facts and retains user assets and theme', () async {
    await settings.completeOnboarding(
      identity: 'postgraduate',
      sources: ['教务处'],
      categories: ['exam'],
      keywords: ['屏蔽'],
    );
    await settings.favorite('notice', 'research');
    await settings.markRead('notice');
    await settings.toggleImportant('notice');
    await settings.togglePin('notice');
    await settings.addTag('notice', '保留');
    await settings.setTheme('dark');
    await settings.createFolder('保留的夹');
    final assets = settings.value;
    await settings.resetOnboarding();
    expect(settings.onboarded, isFalse);
    expect(settings.identity, 'freshman');
    expect(settings.value.subscriptionMode, 'all');
    expect(settings.value.subscribedDepts, isEmpty);
    expect(settings.value.categoryMode, 'all');
    expect(settings.value.subscribedCategories, isEmpty);
    expect(settings.value.blacklistKeywords, isEmpty);
    expect(settings.value.starredIds, assets.starredIds);
    expect(settings.value.starredFolderMap, assets.starredFolderMap);
    expect(settings.value.readIds, assets.readIds);
    expect(settings.value.importantIds, assets.importantIds);
    expect(settings.value.pinnedIds, assets.pinnedIds);
    expect(settings.value.customTags, assets.customTags);
    expect(
      settings.value.folders.map((folder) => folder.toJson()),
      assets.folders.map((folder) => folder.toJson()),
    );
    expect(settings.value.darkMode, 'dark');
    for (final key in [
      onboardingFlagStorageKey,
      onboardingIdentityStorageKey,
      'notifai_subscribed_channels',
      'notifai_subscribed_categories',
      'notifai_black_keywords',
    ]) {
      expect(await store.read(key), isNull);
    }
    await settings.completeOnboarding(
      identity: 'custom',
      sources: [],
      categories: [],
      keywords: [],
    );
    expect(settings.value.starredIds, assets.starredIds);
    expect(settings.value.subscriptionMode, 'all');
    expect(settings.value.categoryMode, 'all');
  });

  test('folder and tag association capacity errors cannot silently evict existing facts', () async {
    final folders = List.generate(
      100,
      (index) => NoticeFolder(
        id: index == 0 ? 'default' : 'folder-$index',
        name: '收藏夹$index',
        icon: r'$folder',
        createdAt: index,
      ),
    );
    final tags = {
      for (var index = 0; index < 10000; index++) 'notice-$index': ['保留'],
    };
    await settings.update(
      settings.value.copyWith(folders: folders, customTags: tags),
    );
    final before = settings.value.toJson();
    await expectLater(settings.createFolder('超出限额'), throwsStateError);
    await expectLater(settings.addTag('new-notice', '超出限额'), throwsStateError);
    expect(settings.value.toJson(), before);
    expect(await store.read(settingsStorageKey), before);
    await settings.removeTag('notice-0', '保留');
    await settings.addTag('new-notice', '新增');
    expect(settings.value.customTags, hasLength(10000));
    expect(settings.value.customTags['new-notice'], ['新增']);
  });

  test('invalid loaded IDs reject the whole mutation rather than partially marking read', () async {
    await settings.markRead('existing');
    final before = settings.value.toJson();
    await expectLater(
      settings.markLoadedRead(['new-valid', '../invalid']),
      throwsA(isA<FormatException>()),
    );
    expect(settings.value.toJson(), before);
    expect(await store.read(settingsStorageKey), before);
  });

  test('reset onboarding is atomic when deletion of its flags fails', () async {
    await settings.completeOnboarding(
      identity: 'postgraduate',
      sources: ['教务处'],
      categories: ['research'],
      keywords: ['保留'],
    );
    final before = settings.value.toJson();
    await store.database.execute('''
      CREATE TRIGGER reject_flag_delete BEFORE DELETE ON kv
      WHEN OLD.key = '$onboardingFlagStorageKey'
      BEGIN SELECT RAISE(ABORT, 'delete denied'); END
    ''');
    await expectLater(
      settings.resetOnboarding(),
      throwsA(isA<DatabaseException>()),
    );
    expect(settings.value.toJson(), before);
    expect(settings.onboarded, isTrue);
    expect(settings.identity, 'postgraduate');
    expect(await store.read(settingsStorageKey), before);
    expect(await store.read(onboardingFlagStorageKey), isTrue);
    expect(await store.read(onboardingIdentityStorageKey), 'postgraduate');
  });

  test('successful preferences remain after closing and reopening a file-backed database', () async {
    final directory = await Directory.systemTemp.createTemp(
      'notifai-settings-',
    );
    final path = '${directory.path}/settings.sqlite';
    LocalStore? disk;
    UserSettings? writer;
    UserSettings? reader;
    try {
      disk = await LocalStore.open(path: path, factory: databaseFactoryFfi);
      writer = UserSettings(disk);
      await writer.initialize();
      await writer.completeOnboarding(
        identity: 'undergraduate',
        sources: ['教务处'],
        categories: ['exam'],
        keywords: ['屏蔽'],
      );
      await writer.favorite('persistent', 'course');
      await writer.toggleImportant('independent');
      await writer.setTheme('dark');
      final expected = writer.value.toJson();
      writer.dispose();
      writer = null;
      await disk.close();
      disk = await LocalStore.open(path: path, factory: databaseFactoryFfi);
      reader = UserSettings(disk);
      await reader.initialize();
      expect(reader.value.toJson(), expected);
      expect(reader.onboarded, isTrue);
      expect(reader.identity, 'undergraduate');
    } finally {
      reader?.dispose();
      writer?.dispose();
      await disk?.close();
      await directory.delete(recursive: true);
    }
  });
}
