import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../data/local_store.dart';
import '../data/models.dart';

const settingsStorageKey = 'notifai-user-settings';
const int maxPreferenceBytes = 5 * 1024 * 1024;
const onboardingFlagStorageKey = 'notifai_has_onboarded';
const onboardingIdentityStorageKey = 'notifai_user_identity';
const _channelsKey = 'notifai_subscribed_channels';
const _categoriesKey = 'notifai_subscribed_categories';
const _keywordsKey = 'notifai_black_keywords';
const _maxItems = 10000;
const _maxFolders = 100;
const _maxTags = 50;
const _futureError = '本机设置由更新版本创建，当前版本已转为只读以避免覆盖';
const _identities = {'freshman', 'undergraduate', 'postgraduate', 'custom'};
const _icons = {
  r'$star',
  r'$school',
  r'$trophy',
  r'$flask',
  r'$domain',
  r'$folder',
};

void _checkSourceLimit(List<String> departments) {
  if (departments.length > 100) {
    throw const FormatException('订阅来源最多选择 100 个，请减少来源后重试');
  }
}

void _checkPreferenceBytes(String json) {
  if (utf8.encode(json).length > maxPreferenceBytes) {
    throw const FormatException('偏好数据超过 5 MiB，请减少标签、标记或关键词后重试');
  }
}

String _backupJson(Map<String, dynamic> preferences) => jsonEncode({
  ...preferences,
  // Millisecond precision keeps export metadata a fixed byte length at the limit.
  'exportedAt': DateTime.fromMillisecondsSinceEpoch(
    DateTime.now().millisecondsSinceEpoch,
    isUtc: true,
  ).toIso8601String(),
});

String _folderIcon(Object? value) {
  if (value is! String) return r'$folder';
  final icon = value.trim();
  if (_icons.contains(icon)) return icon;
  if (icon.startsWith('mdi-')) {
    final alias = '\$${icon.substring(4)}';
    if (_icons.contains(alias)) return alias;
  }
  return r'$folder';
}

bool _safeInteger(Object? value) =>
    value is num &&
    value.isFinite &&
    value >= 0 &&
    value <= 9007199254740991 &&
    value == value.truncateToDouble();

Map<String, dynamic> _record(Object? value) {
  if (value is! Map || value.keys.any((key) => key is! String)) {
    throw const FormatException('设置根节点必须是对象');
  }
  return Map<String, dynamic>.from(value);
}

List<String> _strings(
  Object? value, {
  int length = 200,
  int count = _maxItems,
  bool latest = false,
  bool Function(String)? valid,
}) {
  if (value is! List) return [];
  final candidates = latest && value.length > count
      ? value.skip(value.length - count)
      : value.take(count);
  final seen = <String>{};
  for (final candidate in candidates) {
    if (candidate is! String) continue;
    final item = candidate.trim();
    if (item.isNotEmpty &&
        item.length <= length &&
        (valid == null || valid(item))) {
      seen.add(item);
    }
  }
  return seen.toList();
}

List<String> _ids(Object? value, {bool latest = false}) =>
    _strings(value, length: 128, latest: latest, valid: isValidNoticeId);

class NoticeFolder {
  const NoticeFolder({
    required this.id,
    required this.name,
    required this.icon,
    required this.createdAt,
  });

  final String id;
  final String name;
  final String icon;
  final int createdAt;

  factory NoticeFolder.fromJson(Object? value) {
    final map = _record(value);
    final id = map['id'] is String ? (map['id'] as String).trim() : '';
    final name = map['name'] is String ? (map['name'] as String).trim() : '';
    if (!isValidNoticeId(id) ||
        name.isEmpty ||
        name.length > 100 ||
        !_safeInteger(map['createdAt'])) {
      throw const FormatException('收藏夹数据无效');
    }
    return NoticeFolder(
      id: id,
      name: name,
      icon: _folderIcon(map['icon']),
      createdAt: (map['createdAt'] as num).toInt(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'icon': icon,
    'createdAt': createdAt,
  };
}

const defaultFolders = <NoticeFolder>[
  NoticeFolder(id: 'default', name: '默认收藏', icon: r'$star', createdAt: 0),
  NoticeFolder(id: 'course', name: '课程相关', icon: r'$school', createdAt: 1),
  NoticeFolder(id: 'competition', name: '竞赛活动', icon: r'$trophy', createdAt: 2),
  NoticeFolder(id: 'research', name: '科研学术', icon: r'$flask', createdAt: 3),
  NoticeFolder(id: 'campus', name: '校园生活', icon: r'$domain', createdAt: 4),
];

List<NoticeFolder> _folders(Object? value) {
  if (value is! List) return defaultFolders;
  final result = <NoticeFolder>[];
  final seen = <String>{};
  for (final item in value.take(_maxFolders)) {
    try {
      final folder = NoticeFolder.fromJson(item);
      if (seen.add(folder.id)) result.add(folder);
    } on FormatException {
      // Web backups normalize invalid individual rows, not the entire folder list.
    }
  }
  if (!seen.contains('default')) {
    if (result.length == _maxFolders) result.removeLast();
    result.insert(0, defaultFolders.first);
  }
  return result;
}

class UserPreferences {
  UserPreferences._({
    required this.subscriptionMode,
    required List<String> subscribedDepts,
    required this.categoryMode,
    required List<String> subscribedCategories,
    required List<String> blacklistKeywords,
    required List<String> starredIds,
    required Map<String, String> starredFolderMap,
    required List<String> readIds,
    required List<String> pinnedIds,
    required List<String> importantIds,
    required Map<String, List<String>> customTags,
    required this.darkMode,
    required List<NoticeFolder> folders,
    required this.notificationEnabled,
  }) : subscribedDepts = List.unmodifiable(subscribedDepts),
       subscribedCategories = List.unmodifiable(subscribedCategories),
       blacklistKeywords = List.unmodifiable(blacklistKeywords),
       starredIds = List.unmodifiable(starredIds),
       starredFolderMap = Map.unmodifiable(starredFolderMap),
       readIds = List.unmodifiable(readIds),
       pinnedIds = List.unmodifiable(pinnedIds),
       importantIds = List.unmodifiable(importantIds),
       customTags = Map.unmodifiable(
         customTags.map(
           (id, tags) => MapEntry(id, List<String>.unmodifiable(tags)),
         ),
       ),
       folders = List.unmodifiable(folders);

  final int schemaVersion = 3;
  final String subscriptionMode;
  final List<String> subscribedDepts;
  final String categoryMode;
  final List<String> subscribedCategories;
  final List<String> blacklistKeywords;
  final List<String> starredIds;
  final Map<String, String> starredFolderMap;
  final List<String> readIds;
  final List<String> pinnedIds;
  final List<String> importantIds;
  final Map<String, List<String>> customTags;
  final String darkMode;
  final List<NoticeFolder> folders;
  final bool notificationEnabled;

  factory UserPreferences.defaults() => UserPreferences._(
    subscriptionMode: 'all',
    subscribedDepts: [],
    categoryMode: 'all',
    subscribedCategories: [],
    blacklistKeywords: [],
    starredIds: [],
    starredFolderMap: {},
    readIds: [],
    pinnedIds: [],
    importantIds: [],
    customTags: {},
    darkMode: 'auto',
    folders: defaultFolders,
    notificationEnabled: false,
  );

  factory UserPreferences.fromJson(Object? value, {bool importing = false}) {
    final map = _record(value);
    final version = map['schemaVersion'];
    if (map.containsKey('schemaVersion') &&
        (!_safeInteger(version) || (version as num) < 1)) {
      throw const FormatException('设置版本无效');
    }
    if (importing && version is num && version > 3) {
      throw const FormatException('备份由更新版本创建，无法导入');
    }
    if (importing) _validateImportShape(map);
    final departments = _strings(map['subscribedDepts'])
        .map(normalizeSource)
        .toSet()
        .toList();
    if (importing) _checkSourceLimit(departments);
    final categories = _strings(
      map['subscribedCategories'],
      length: 100,
      count: categoryNames.length,
      valid: categoryNames.containsKey,
    ).toSet();
    final favorites = _ids(map['starredIds']);
    final folders = _folders(map['folders']);
    final folderIds = folders.map((folder) => folder.id).toSet();
    final rawFolderMap = map['starredFolderMap'];
    final folderMap = <String, String>{};
    for (final id in favorites) {
      final folder = rawFolderMap is Map ? rawFolderMap[id] : null;
      folderMap[id] = folder is String && folderIds.contains(folder)
          ? folder
          : 'default';
    }
    final tags = <String, List<String>>{};
    final rawTags = map['customTags'];
    if (rawTags is Map) {
      for (final entry in rawTags.entries.take(_maxItems)) {
        if (!isValidNoticeId(entry.key)) continue;
        final list = _strings(entry.value, length: 50, count: _maxTags);
        if (list.isNotEmpty) tags[entry.key as String] = list;
      }
    }
    return UserPreferences._(
      subscriptionMode: _mode(map['subscriptionMode'], departments),
      subscribedDepts: departments,
      categoryMode: _mode(map['categoryMode'], categories),
      subscribedCategories: categoryNames.keys
          .where(categories.contains)
          .toList(),
      blacklistKeywords: _strings(map['blacklistKeywords']),
      starredIds: favorites,
      starredFolderMap: folderMap,
      readIds: _ids(map['readIds'], latest: true),
      pinnedIds: _ids(map['pinnedIds']),
      importantIds: _ids(map['importantIds']),
      customTags: tags,
      darkMode: const {'auto', 'light', 'dark'}.contains(map['darkMode'])
          ? map['darkMode'] as String
          : 'auto',
      folders: folders,
      notificationEnabled: map['notificationEnabled'] == true,
    );
  }

  static String _mode(Object? requested, Iterable<String> items) =>
      items.isEmpty
      ? 'all'
      : requested == 'all'
      ? 'all'
      : 'custom';

  static void _validateImportShape(Map<String, dynamic> map) {
    const lists = {
      'subscribedDepts',
      'subscribedCategories',
      'blacklistKeywords',
      'starredIds',
      'readIds',
      'pinnedIds',
      'importantIds',
      'folders',
    };
    const maps = {'starredFolderMap', 'customTags'};
    const scalars = {
      'subscriptionMode',
      'categoryMode',
      'darkMode',
      'notificationEnabled',
    };
    if (!map.keys.any(
      (key) =>
          lists.contains(key) || maps.contains(key) || scalars.contains(key),
    )) {
      throw const FormatException('文件不包含用户偏好');
    }
    for (final key in lists) {
      if (map.containsKey(key) && map[key] is! List) {
        throw FormatException('备份字段 $key 必须是数组');
      }
    }
    for (final key in maps) {
      if (map.containsKey(key)) _record(map[key]);
    }
    for (final key in const ['subscriptionMode', 'categoryMode']) {
      if (map.containsKey(key) && !const {'all', 'custom'}.contains(map[key])) {
        throw FormatException('备份字段 $key 无效');
      }
    }
    if (map.containsKey('darkMode') &&
        !const {'auto', 'light', 'dark'}.contains(map['darkMode'])) {
      throw const FormatException('备份主题无效');
    }
    if (map.containsKey('notificationEnabled') &&
        map['notificationEnabled'] is! bool) {
      throw const FormatException('备份提醒开关无效');
    }
  }

  UserPreferences copyWith({
    int? schemaVersion,
    String? subscriptionMode,
    List<String>? subscribedDepts,
    String? categoryMode,
    List<String>? subscribedCategories,
    List<String>? blacklistKeywords,
    List<String>? starredIds,
    Map<String, String>? starredFolderMap,
    List<String>? readIds,
    List<String>? pinnedIds,
    List<String>? importantIds,
    Map<String, List<String>>? customTags,
    String? darkMode,
    List<NoticeFolder>? folders,
    bool? notificationEnabled,
  }) {
    if (schemaVersion != null && schemaVersion != 3) {
      throw const FormatException('当前仅可写入第 3 版用户偏好');
    }
    return UserPreferences._(
      subscriptionMode: subscriptionMode ?? this.subscriptionMode,
      subscribedDepts: subscribedDepts ?? this.subscribedDepts,
      categoryMode: categoryMode ?? this.categoryMode,
      subscribedCategories: subscribedCategories ?? this.subscribedCategories,
      blacklistKeywords: blacklistKeywords ?? this.blacklistKeywords,
      starredIds: starredIds ?? this.starredIds,
      starredFolderMap: starredFolderMap ?? this.starredFolderMap,
      readIds: readIds ?? this.readIds,
      pinnedIds: pinnedIds ?? this.pinnedIds,
      importantIds: importantIds ?? this.importantIds,
      customTags: customTags ?? this.customTags,
      darkMode: darkMode ?? this.darkMode,
      folders: folders ?? this.folders,
      notificationEnabled: notificationEnabled ?? this.notificationEnabled,
    );
  }

  Map<String, dynamic> toJson() => {
    'schemaVersion': schemaVersion,
    'subscriptionMode': subscriptionMode,
    'subscribedDepts': [...subscribedDepts],
    'categoryMode': categoryMode,
    'subscribedCategories': [...subscribedCategories],
    'blacklistKeywords': [...blacklistKeywords],
    'starredIds': [...starredIds],
    'starredFolderMap': {...starredFolderMap},
    'readIds': [...readIds],
    'pinnedIds': [...pinnedIds],
    'importantIds': [...importantIds],
    'customTags': customTags.map((id, tags) => MapEntry(id, [...tags])),
    'darkMode': darkMode,
    'folders': folders.map((folder) => folder.toJson()).toList(),
    'notificationEnabled': notificationEnabled,
  };
}

class UserSettings extends ChangeNotifier {
  UserSettings(this._store);

  final LocalStore _store;
  UserPreferences _value = UserPreferences.defaults();
  bool _onboarded = false;
  String _identity = 'freshman';
  bool _readOnly = false;
  String? _error;
  Object? _futureRaw;
  Future<void>? _initialization;
  Future<void> _pending = Future<void>.value();
  int _folderSequence = 0;

  UserPreferences get value => _value;
  bool get onboarded => _onboarded;
  String get identity => _identity;
  bool get readOnly => _readOnly;
  String? get error => _error;

  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  Future<void> initialize() => _initialization ??= _load();

  Object? _decode(Object? raw) => raw is String ? jsonDecode(raw) : raw;

  bool _isFuture(Object? raw) {
    Object? decoded;
    try {
      decoded = _decode(raw);
    } on FormatException {
      return false;
    }
    return decoded is Map &&
        decoded['schemaVersion'] is num &&
        _safeInteger(decoded['schemaVersion']) &&
        (decoded['schemaVersion'] as num) > 3;
  }

  Future<void> _load() async {
    try {
      final raw = await _store.read(settingsStorageKey);
      if (raw != null) {
        final decoded = _decode(raw);
        final loaded = UserPreferences.fromJson(decoded);
        _value = loaded;
        if (_isFuture(raw)) {
          _readOnly = true;
          _futureRaw = raw;
          _error = _futureError;
        } else {
          final version = _record(decoded)['schemaVersion'];
          if (version == null || (version as num) < 3) {
            try {
              final preferences = loaded.toJson();
              _checkPreferenceBytes(_backupJson(preferences));
              await _store.writeAll({settingsStorageKey: preferences});
            } catch (exception) {
              _error = '本机设置迁移未保存，已保留现有偏好和原始数据：$exception';
            }
          }
        }
      }
    } catch (exception) {
      _value = UserPreferences.defaults();
      _error = '本机设置读取或迁移失败，已使用安全默认值；原始数据未被替换：$exception';
    }
    try {
      final flag = await _store.read(onboardingFlagStorageKey);
      final identity = await _store.read(onboardingIdentityStorageKey);
      _onboarded = flag == true || flag == 'true';
      _identity = identity is String && _identities.contains(identity)
          ? identity
          : 'freshman';
    } catch (exception) {
      _error ??= '入门设置读取失败：$exception';
    }
    notifyListeners();
  }

  Future<void> _enqueue(Future<void> Function() action) {
    final operation = _pending.then((_) async {
      await initialize();
      try {
        if (_readOnly) throw StateError(_futureError);
        await action();
      } catch (exception) {
        _error = _readOnly
            ? _futureError
            : exception is FormatException
            ? exception.message
            : '偏好保存失败：$exception';
        rethrow;
      }
    });
    // A rejected write must not poison subsequent queued actions.
    _pending = operation.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return operation;
  }

  Future<void> _commit(
    UserPreferences next, {
    Map<String, Object?> extra = const {},
    bool? onboarded,
    String? identity,
  }) async {
    final stored = await _store.read(settingsStorageKey);
    if (stored != null && _isFuture(stored)) {
      _readOnly = true;
      _futureRaw = stored;
      _error = _futureError;
      throw StateError(_futureError);
    }
    final normalized = UserPreferences.fromJson(next.toJson());
    _checkSourceLimit(normalized.subscribedDepts);
    final preferences = normalized.toJson();
    _checkPreferenceBytes(_backupJson(preferences));
    await _store.writeAll({settingsStorageKey: preferences, ...extra});
    _value = normalized;
    if (onboarded != null) _onboarded = onboarded;
    if (identity != null) _identity = identity;
    _error = null;
    notifyListeners();
  }

  Future<void> update(UserPreferences next) => _enqueue(() => _commit(next));

  Future<void> completeOnboarding({
    required String identity,
    required List<String> sources,
    required List<String> categories,
    required List<String> keywords,
  }) => _enqueue(() async {
    final selectedIdentity = _identities.contains(identity)
        ? identity
        : 'custom';
    final departments = _strings(sources).map(normalizeSource).toSet().toList();
    final next = UserPreferences.fromJson(
      _value
          .copyWith(
            subscriptionMode: departments.isEmpty ? 'all' : 'custom',
            subscribedDepts: departments,
            categoryMode: categories.isEmpty ? 'all' : 'custom',
            subscribedCategories: categories,
            blacklistKeywords: keywords,
          )
          .toJson(),
    );
    await _commit(
      next,
      onboarded: true,
      identity: selectedIdentity,
      extra: {
        onboardingFlagStorageKey: true,
        onboardingIdentityStorageKey: selectedIdentity,
        _channelsKey: next.subscribedDepts,
        _categoriesKey: next.subscribedCategories,
        _keywordsKey: next.blacklistKeywords,
      },
    );
  });

  Future<void> resetOnboarding() => _enqueue(
    () => _commit(
      _value.copyWith(
        subscriptionMode: 'all',
        subscribedDepts: [],
        categoryMode: 'all',
        subscribedCategories: [],
        blacklistKeywords: [],
      ),
      onboarded: false,
      identity: 'freshman',
      extra: {
        onboardingFlagStorageKey: null,
        onboardingIdentityStorageKey: null,
        _channelsKey: null,
        _categoriesKey: null,
        _keywordsKey: null,
      },
    ),
  );

  void _validateId(String id) {
    if (!isValidNoticeId(id)) throw const FormatException('通知标识无效');
  }

  Future<void> markRead(String id) => markLoadedRead([id]);

  Future<void> toggleRead(String id) => _enqueue(() async {
    _validateId(id);
    final read = [..._value.readIds];
    if (read.contains(id)) {
      read.remove(id);
    } else {
      read.add(id);
      if (read.length > _maxItems) read.removeAt(0);
    }
    await _commit(_value.copyWith(readIds: read));
  });

  Future<void> markLoadedRead(Iterable<String> ids) {
    final captured = ids.toList();
    return _enqueue(() async {
      final read = _value.readIds.toSet();
      for (final id in captured) {
        _validateId(id);
        read.add(id);
      }
      if (read.length == _value.readIds.length) return;
      final list = read.toList();
      await _commit(
        _value.copyWith(
          readIds: list.length > _maxItems
              ? list.sublist(list.length - _maxItems)
              : list,
        ),
      );
    });
  }

  Future<void> clearRead() =>
      _enqueue(() => _commit(_value.copyWith(readIds: [])));

  Future<void> _toggle(String id, {required bool important}) => _enqueue(
    () async {
      _validateId(id);
      final ids = [...(important ? _value.importantIds : _value.pinnedIds)];
      if (!ids.remove(id)) {
        if (ids.length >= _maxItems) throw StateError('此类标记最多保存 $_maxItems 条');
        ids.add(id);
      }
      await _commit(
        important
            ? _value.copyWith(importantIds: ids)
            : _value.copyWith(pinnedIds: ids),
      );
    },
  );

  Future<void> togglePin(String id) => _toggle(id, important: false);
  Future<void> toggleImportant(String id) => _toggle(id, important: true);

  Future<void> favorite(String id, String folderId) => _enqueue(() async {
    _validateId(id);
    final ids = [..._value.starredIds];
    if (!ids.contains(id)) {
      if (ids.length >= _maxItems) throw StateError('收藏最多保存 $_maxItems 条');
      ids.add(id);
    }
    final folder = _value.folders.any((folder) => folder.id == folderId)
        ? folderId
        : 'default';
    await _commit(
      _value.copyWith(
        starredIds: ids,
        starredFolderMap: {..._value.starredFolderMap, id: folder},
      ),
    );
  });

  Future<void> unfavorite(String id) => _enqueue(() async {
    _validateId(id);
    final folders = {..._value.starredFolderMap}..remove(id);
    await _commit(
      _value.copyWith(
        starredIds: _value.starredIds.where((item) => item != id).toList(),
        starredFolderMap: folders,
      ),
    );
  });

  Future<void> addTag(String id, String tag) => _enqueue(() async {
    _validateId(id);
    final normalized = tag.trim();
    if (normalized.isEmpty || normalized.length > 50) {
      throw const FormatException('标签须为 1–50 个字符');
    }
    final tags = [...?_value.customTags[id]];
    if (tags.contains(normalized)) return;
    if (tags.length >= _maxTags) throw StateError('每条通知最多保存 $_maxTags 个标签');
    if (!_value.customTags.containsKey(id) &&
        _value.customTags.length >= _maxItems) {
      throw StateError('自定义标签最多关联 $_maxItems 条通知');
    }
    tags.add(normalized);
    await _commit(
      _value.copyWith(customTags: {..._value.customTags, id: tags}),
    );
  });

  Future<void> removeTag(String id, String tag) => _enqueue(() async {
    _validateId(id);
    final tags = [...?_value.customTags[id]];
    if (!tags.remove(tag.trim())) return;
    final map = {..._value.customTags};
    if (tags.isEmpty) {
      map.remove(id);
    } else {
      map[id] = tags;
    }
    await _commit(_value.copyWith(customTags: map));
  });

  Future<void> createFolder(String name, {String icon = r'$folder'}) =>
      _enqueue(() async {
        if (_value.folders.length >= _maxFolders) {
          throw StateError('最多只能创建 $_maxFolders 个收藏夹');
        }
        final createdAt = DateTime.now().millisecondsSinceEpoch;
        String id;
        do {
          id = 'folder-$createdAt-${++_folderSequence}';
        } while (_value.folders.any((folder) => folder.id == id));
        final trimmed = name.trim();
        final normalized = trimmed.isEmpty
            ? '未命名收藏夹'
            : trimmed.length > 100
            ? trimmed.substring(0, 100)
            : trimmed;
        await _commit(
          _value.copyWith(
            folders: [
              ..._value.folders,
              NoticeFolder(
                id: id,
                name: normalized,
                icon: _folderIcon(icon),
                createdAt: createdAt,
              ),
            ],
          ),
        );
      });

  Future<void> renameFolder(String id, String name) => _enqueue(() async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) throw const FormatException('收藏夹名称不能为空');
    if (!_value.folders.any((folder) => folder.id == id)) {
      throw const FormatException('收藏夹不存在');
    }
    final normalized = trimmed.length > 100
        ? trimmed.substring(0, 100)
        : trimmed;
    await _commit(
      _value.copyWith(
        folders: _value.folders
            .map(
              (folder) => folder.id == id
                  ? NoticeFolder(
                      id: folder.id,
                      name: normalized,
                      icon: folder.icon,
                      createdAt: folder.createdAt,
                    )
                  : folder,
            )
            .toList(),
      ),
    );
  });

  Future<void> deleteFolder(String id) => _enqueue(() async {
    if (id == 'default') throw const FormatException('默认收藏夹不能删除');
    if (!_value.folders.any((folder) => folder.id == id)) return;
    await _commit(
      _value.copyWith(
        folders: _value.folders.where((folder) => folder.id != id).toList(),
        starredFolderMap: _value.starredFolderMap.map(
          (noticeId, folderId) =>
              MapEntry(noticeId, folderId == id ? 'default' : folderId),
        ),
      ),
    );
  });

  Future<void> setTheme(String mode) => _enqueue(() async {
    if (!const {'auto', 'light', 'dark'}.contains(mode)) {
      throw const FormatException('主题模式无效');
    }
    await _commit(_value.copyWith(darkMode: mode));
  });

  Future<void> importBackup(String json) => _enqueue(() async {
    _checkPreferenceBytes(json);
    final imported = UserPreferences.fromJson(
      jsonDecode(json),
      importing: true,
    );
    await _commit(imported);
  });

  String exportBackup() {
    final json = _readOnly && _futureRaw != null
        ? jsonEncode(_decode(_futureRaw))
        : _backupJson(_value.toJson());
    _checkPreferenceBytes(json);
    return json;
  }
}
