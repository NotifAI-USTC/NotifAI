import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../data/models.dart';
import '../data/notice_repository.dart';
import 'user_settings.dart';

class FeedFilters {
  const FeedFilters({
    this.keyword = '',
    this.source,
    this.contentType,
    this.categories = const [],
    this.dateFrom,
    this.dateTo,
    this.hasDeadline,
    this.isRead,
    this.isStarred,
    this.tags = const [],
  });
  final String keyword;
  final String? source, contentType, dateFrom, dateTo;
  final List<String> categories, tags;
  final bool? hasDeadline, isRead, isStarred;
}

class NoticeFeed extends ChangeNotifier {
  NoticeFeed(this.repository, this.settings) {
    _preferenceKey = _preferencesKey();
    settings.addListener(_onPreferences);
  }
  final NoticeRepository repository;
  final UserSettings settings;
  final List<Notice> _items = [];
  FeedFilters? filters;
  String keyword = '';
  String? error, cacheMessage;
  bool loading = false, finished = false, scanPaused = false;
  int total = 0, invalidItemCount = 0;
  int _generation = 0, _nextPage = 1;
  String? _cursor;
  bool _cursorMode = false, _disposed = false;
  late String _preferenceKey;
  List<Notice> get loaded => List.unmodifiable(_items);

  String _preferencesKey() {
    final p = settings.value;
    return jsonEncode([
      p.subscriptionMode,
      p.subscribedDepts,
      p.categoryMode,
      p.subscribedCategories,
      p.blacklistKeywords,
      if (filters?.isRead == false) p.readIds,
      if (filters?.isStarred == false) p.starredIds,
    ]);
  }

  void _onPreferences() {
    final key = _preferencesKey();
    if (key != _preferenceKey) {
      _preferenceKey = key;
      refresh();
    } else {
      _notify();
    }
  }

  NoticeQuery get query {
    final p = settings.value;
    return NoticeQuery(
      keyword: (filters?.keyword ?? keyword).trim().isEmpty
          ? null
          : (filters?.keyword ?? keyword).trim(),
      source: filters?.source,
      contentType: filters?.contentType,
      categories:
          filters?.categories ??
          (p.categoryMode == 'custom' ? p.subscribedCategories : const []),
      sources: p.subscriptionMode == 'custom' ? p.subscribedDepts : const [],
      dateFrom: filters?.dateFrom,
      dateTo: filters?.dateTo,
      hasDeadline: filters?.hasDeadline,
      excludeIds: {
        if (filters?.isRead == false) ...p.readIds,
        if (filters?.isStarred == false) ...p.starredIds,
      }.take(500).toList(),
    );
  }

  bool _matches(Notice n, NoticeQuery q) {
    final p = settings.value;
    final text = '${n.title} ${normalizeSource(n.source)} ${n.aiSummary}'
        .toLowerCase();
    return (q.keyword == null || text.contains(q.keyword!.toLowerCase())) &&
        (q.source == null || normalizeSource(n.source) == q.source) &&
        (q.sources.isEmpty || q.sources.contains(normalizeSource(n.source))) &&
        (q.categories.isEmpty || n.categories.any(q.categories.contains)) &&
        (q.contentType == null || n.contentType == q.contentType) &&
        (q.dateFrom == null || n.publishDate.compareTo(q.dateFrom!) >= 0) &&
        (q.dateTo == null || n.publishDate.compareTo(q.dateTo!) <= 0) &&
        (q.hasDeadline == null || (n.deadline != null) == q.hasDeadline) &&
        (filters?.isRead == null ||
            p.readIds.contains(n.id) == filters!.isRead) &&
        (filters?.isStarred == null ||
            p.starredIds.contains(n.id) == filters!.isStarred) &&
        !p.blacklistKeywords.any((word) => text.contains(word.toLowerCase())) &&
        (filters?.tags.every(
              (tag) => (p.customTags[n.id] ?? const []).contains(tag),
            ) ??
            true);
  }

  List<Notice> get visible {
    final q = query;
    final entries = _items.where((n) => _matches(n, q)).toList();
    final order = {for (var i = 0; i < _items.length; i++) _items[i].id: i};
    final pins = {
      for (var i = 0; i < settings.value.pinnedIds.length; i++)
        settings.value.pinnedIds[i]: i,
    };
    entries.sort((a, b) {
      final aPin = pins[a.id], bPin = pins[b.id];
      if (aPin != null || bPin != null) {
        return (bPin ?? -1).compareTo(aPin ?? -1);
      }
      return order[a.id]!.compareTo(order[b.id]!);
    });
    return entries;
  }

  Future<void> search(String text) async {
    keyword = text;
    filters = null;
    await refresh(useCache: true, clear: true);
  }

  Future<void> apply(FeedFilters? next) async {
    filters = next;
    keyword = next?.keyword ?? '';
    _preferenceKey = _preferencesKey();
    await refresh(useCache: true, clear: true);
  }

  Future<void> refresh({bool useCache = false, bool clear = false}) async {
    final generation = ++_generation;
    final q = query;
    loading = true;
    error = null;
    scanPaused = false;
    if (clear) {
      _items.clear();
      total = 0;
      cacheMessage = null;
    }
    _notify();
    if (useCache && _items.isEmpty) {
      try {
        final cached = await repository.cachedFeed(q);
        if (!_current(generation)) return;
        if (cached != null) {
          _items.addAll(cached.value.items);
          total = cached.value.total;
          cacheMessage =
              '显示${cached.stale ? '较旧的' : ''}本地缓存（${cached.savedAt.toLocal().toString().substring(0, 16)}），正在同步。';
          _notify();
        }
      } catch (e) {
        if (_current(generation)) error = '缓存读取失败：$e';
      }
    }
    await _fetch(q, generation, replacing: true);
  }

  Future<void> loadMore() async {
    if (loading || finished) return;
    loading = true;
    error = null;
    scanPaused = false;
    _notify();
    await _fetch(query, _generation, replacing: false);
  }

  Future<void> _fetch(
    NoticeQuery q,
    int generation, {
    required bool replacing,
  }) async {
    var page = replacing ? 1 : _nextPage;
    var cursor = replacing ? null : _cursor;
    var cursorMode = replacing ? false : _cursorMode;
    final batch = <Notice>[];
    var invalid = replacing ? 0 : invalidItemCount;
    var done = false;
    var count = total;
    final cursors = <String>{?cursor};
    try {
      for (var attempt = 0; attempt < 5; attempt++) {
        final response = await repository.list(
          q.copyWith(page: page, cursor: cursor),
        );
        if (!_current(generation)) return;
        count = response.total;
        invalid += response.invalidItemCount;
        cursorMode = cursorMode || response.nextCursor != null;
        if (response.nextCursor != null && !cursors.add(response.nextCursor!)) {
          throw const ApiException('服务端返回重复分页游标，请重试');
        }
        batch.addAll(response.items);
        cursor = response.nextCursor;
        done =
            response.rawItemCount == 0 ||
            (cursorMode ? cursor == null : page * q.pageSize >= count);
        page++;
        if (done || batch.any((n) => _matches(n, q))) break;
      }
      if (!_current(generation)) return;
      final merged = <String, Notice>{
        if (!replacing)
          for (final item in _items) item.id: item,
        for (final item in batch) item.id: item,
      };
      _items
        ..clear()
        ..addAll(merged.values);
      _nextPage = page;
      _cursor = cursor;
      _cursorMode = cursorMode;
      total = count;
      invalidItemCount = invalid;
      finished = done;
      scanPaused = !done && !batch.any((n) => _matches(n, q));
      cacheMessage = null;
      error = null;
      // Persist a safe first-page snapshot. Pagination resumes from the server on
      // restart, never by treating a cached aggregate as a complete result set.
      try {
        await repository.saveFeed(
          q,
          NoticePage(
            items: _items.take(500).toList(),
            total: total,
            nextCursor: _cursor,
          ),
        );
      } catch (e) {
        if (_current(generation)) cacheMessage = '通知已更新，但离线缓存保存失败：$e';
      }
    } catch (e) {
      if (_current(generation)) {
        error = '$e${_items.isNotEmpty ? '；当前保留已加载数据。' : ''}';
      }
    } finally {
      if (_current(generation)) {
        loading = false;
        _notify();
      }
    }
  }

  bool _current(int generation) => !_disposed && generation == _generation;
  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    settings.removeListener(_onPreferences);
    super.dispose();
  }
}
