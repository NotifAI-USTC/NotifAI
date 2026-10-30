import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'local_store.dart';
import 'models.dart';

class ApiException implements Exception {
  const ApiException(
    this.message, {
    this.statusCode,
    this.cause,
    this.responseBody,
  });
  final String message;
  final int? statusCode;
  final Object? cause;
  final String? responseBody;
  @override
  String toString() => message;
}

class CachedValue<T> {
  const CachedValue(this.value, this.savedAt);
  final T value;
  final DateTime savedAt;
  bool get stale =>
      DateTime.now().difference(savedAt) > const Duration(days: 30);
}

class NoticeRepository {
  NoticeRepository({
    required this.store,
    required String baseUrl,
    http.Client? client,
  }) : _base = _validateBase(baseUrl),
       _client = client ?? http.Client(),
       _ownsClient = client == null;
  final LocalStore store;
  final Uri _base;
  final http.Client _client;
  final bool _ownsClient;
  Future<void> _cacheTail = Future.value();
  bool _disposed = false;
  String? _cacheWarning;
  String? get cacheWarning => _cacheWarning;
  static const _listLimit = 16 * 1024 * 1024;
  static const _detailLimit = 8 * 1024 * 1024;
  String get _prefix => 'notice-cache.v1:${_base.toString()}:';

  static Uri _validateBase(String value) {
    final uri = hasRawUrlCredentials(value) ? null : Uri.tryParse(value.trim());
    final local =
        uri != null &&
        const {
          'localhost',
          '127.0.0.1',
          '::1',
          '[::1]',
          '10.0.2.2',
        }.contains(uri.host.toLowerCase());
    if (uri == null ||
        !uri.isAbsolute ||
        !isValidHttpUri(uri) ||
        uri.hasQuery ||
        uri.hasFragment ||
        !(uri.scheme == 'https' ||
            (kDebugMode && local && uri.scheme == 'http'))) {
      throw const ApiException(
        '通知 API 地址必须是无凭据、查询参数和片段的绝对 HTTPS 地址；调试时仅允许本机 HTTP',
      );
    }
    return uri.replace(
      path: uri.path.endsWith('/') ? uri.path : '${uri.path}/',
    );
  }

  Future<Object?> _request(
    String path, {
    Map<String, dynamic>? query,
    Object? body,
    int maxBytes = _listLimit,
  }) async {
    if (_disposed) throw const ApiException('通知服务连接已关闭');
    final uri = _base
        .resolve(path)
        .replace(queryParameters: query?.isEmpty == true ? null : query);
    final abort = Completer<void>();
    void cancel() {
      if (!abort.isCompleted) abort.complete();
    }

    final request =
        http.AbortableRequest(
            body == null ? 'GET' : 'POST',
            uri,
            abortTrigger: abort.future,
          )
          ..followRedirects = false
          ..headers['Accept'] = 'application/json';
    if (body != null) {
      request.headers['Content-Type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }
    Future<Object?> receive() async {
      final response = await _client.send(request);
      if (response.contentLength != null &&
          response.contentLength! > maxBytes) {
        cancel();
        // Listening then cancelling also releases clients that do not support abortion.
        await response.stream.listen((_) {}).cancel();
        throw const ApiException('通知服务响应过大，已停止下载');
      }
      final bytes = BytesBuilder(copy: false);
      await for (final chunk in response.stream) {
        if (bytes.length + chunk.length > maxBytes) {
          cancel();
          throw const ApiException('通知服务响应过大，已停止下载');
        }
        bytes.add(chunk);
      }
      final failed = response.statusCode < 200 || response.statusCode >= 300;
      final text = utf8.decode(bytes.takeBytes(), allowMalformed: failed);
      if (failed) {
        throw ApiException(
          response.statusCode == 404
              ? '通知不存在或已移除（404）'
              : '通知服务请求失败（${response.statusCode}）',
          statusCode: response.statusCode,
          responseBody: text,
        );
      }
      return jsonDecode(text);
    }

    try {
      return await receive().timeout(
        const Duration(seconds: 10),
        onTimeout: () {
          cancel();
          throw const ApiException('请求超时，请稍后重试');
        },
      );
    } on ApiException {
      rethrow;
    } on FormatException catch (error) {
      throw ApiException('通知服务返回了无效的 JSON 数据', cause: error);
    } catch (error) {
      throw ApiException('无法连接通知服务，请检查网络', cause: error);
    } finally {
      cancel();
    }
  }

  T _parse<T>(T Function() action) {
    try {
      return action();
    } on DataValidationException catch (error) {
      throw ApiException('通知服务返回数据无效：${error.message}', cause: error);
    }
  }

  Future<NoticePage> list(NoticeQuery query) async {
    final json = await _request('notices', query: query.toParameters());
    return _parse(() => NoticePage.fromJson(json));
  }

  Future<Notice> detail(String id) async {
    validatedNoticeId(id);
    final json = await _request(
      'notices/${Uri.encodeComponent(id)}',
      maxBytes: _detailLimit,
    );
    final notice = _parse(() {
      final notice = Notice.fromJson(json);
      if (notice.id != id) throw const DataValidationException('详情 ID 与请求不一致');
      return notice;
    });
    await saveDetail(notice);
    return notice;
  }

  Future<List<Notice>> batch(List<String> ids) async {
    if (ids.isEmpty || ids.length > 500) {
      throw const DataValidationException('批量通知 ID 必须是 1 到 500 项');
    }
    final requested = ids.map(validatedNoticeId).toSet();
    final json = await _request(
      'notices/batch',
      body: {'ids': requested.toList()},
    );
    final items = _parse(() {
      final r = validatedRecord(json);
      final rows = validatedRows(r['items'], Notice.fromJson, (n) => n.id);
      final missing = r['missing'] ?? const [];
      if (missing is! List || missing.length > 1000) {
        throw const DataValidationException('missing 必须是有效 ID 数组');
      }
      final seen = <String>{};
      final returned = rows.items.map((n) => n.id).toSet();
      for (final raw in missing) {
        final id = validatedNoticeId(raw);
        if (!seen.add(id) || !requested.contains(id) || returned.contains(id)) {
          throw const DataValidationException('missing 包含重复、未请求或已返回的 ID');
        }
      }
      if (returned.any((id) => !requested.contains(id))) {
        throw const DataValidationException('批量详情包含未请求的 ID');
      }
      return rows.items;
    });
    await _serial(() => _saveDetails(items));
    return items;
  }

  Future<List<SourceItem>> sources() async {
    final json = await _request('sources');
    final items = _parse(() => _sourceItems(json));
    await _serial(
      () => _saveCatalog('sources', items.map((s) => s.toJson()).toList()),
    );
    return items;
  }

  Future<List<CategoryItem>> categories() async {
    final json = await _request('categories');
    final items = _parse(() => _categoryItems(json));
    await _serial(
      () => _saveCatalog('categories', items.map((c) => c.toJson()).toList()),
    );
    return items;
  }

  Future<Stats> stats() async {
    final json = await _request('stats');
    return _parse(() => Stats.fromJson(json));
  }

  Future<List<CalendarEntry>> calendar({String? month, String? week}) async {
    if ((month == null) == (week == null)) {
      throw const DataValidationException('month 与 week 必须二选一');
    }
    if (month != null) {
      if (!RegExp(r'^\d{4}-\d{2}$').hasMatch(month)) {
        throw const DataValidationException('month 必须使用 YYYY-MM 格式');
      }
      parseDateOnly('$month-01');
    }
    if (week != null) {
      final match = RegExp(r'^(\d{4})-W(\d{2})$').firstMatch(week);
      if (match == null) {
        throw const DataValidationException('week 必须使用 YYYY-Www 格式');
      }
      final year = int.parse(match[1]!);
      final number = int.parse(match[2]!);
      final jan1 = DateTime.utc(year, 1, 1).weekday;
      final leap = DateTime.utc(year, 3, 0).day == 29;
      final max =
          jan1 == DateTime.thursday || (jan1 == DateTime.wednesday && leap)
          ? 53
          : 52;
      if (year < 2000 || year > 2100 || number < 1 || number > max) {
        throw const DataValidationException('ISO 周日期无效');
      }
    }
    final json = await _request(
      'notices/calendar',
      query: month != null ? {'month': month} : {'week': week},
    );
    return _parse(
      () => validatedRows(
        validatedRecord(json)['items'],
        CalendarEntry.fromJson,
        (n) => n.id,
      ).items,
    );
  }

  Future<List<DeadlineEntry>> deadlines({
    int days = 3,
    List<String> sources = const [],
    int page = 1,
    int pageSize = 50,
  }) async {
    if (days < 1 ||
        days > 365 ||
        page < 1 ||
        page > 9007199254740991 ||
        pageSize < 1 ||
        pageSize > 500) {
      throw const DataValidationException('截止通知查询范围或分页无效');
    }
    final query =
        NoticeQuery(
            sources: sources,
            page: page,
            pageSize: pageSize,
          ).toParameters()
          ..remove('light')
          ..['days'] = '$days';
    final json = await _request('notices/deadlines', query: query);
    return _parse(() {
      final r = validatedRecord(json);
      final rows = validatedRows(
        r['items'],
        DeadlineEntry.fromJson,
        (n) => n.id,
        max: 500,
      );
      if (validatedCount(r['total'], max: 10000000) < rows.items.length) {
        throw const DataValidationException('总数小于实际通知数量');
      }
      return rows.items;
    });
  }

  List<SourceItem> _sourceItems(Object? json) {
    if (json is! List || json.length > 1000) {
      throw const DataValidationException('来源目录必须是至多 1000 项的数组');
    }
    final names = <String>{};
    final items = json.map(SourceItem.fromJson).toList();
    for (final item in items) {
      if (!names.add(item.name)) {
        throw const DataValidationException('来源目录存在重复名称');
      }
    }
    return List.unmodifiable(items);
  }

  List<CategoryItem> _categoryItems(Object? json) {
    if (json is! List || json.length != categoryNames.length) {
      throw const DataValidationException('分类目录必须包含完整的 17 项分类');
    }
    final keys = <String>{};
    final items = json.map(CategoryItem.fromJson).toList();
    for (final item in items) {
      if (!keys.add(item.key)) {
        throw const DataValidationException('分类目录存在重复分类');
      }
    }
    return List.unmodifiable(items);
  }

  Future<T> _serial<T>(Future<T> Function() action) {
    final result = _cacheTail.then((_) => action());
    _cacheTail = result.then<void>(
      (_) {},
      onError: (Object error, StackTrace stack) {},
    );
    return result;
  }

  Future<List<String>> _index(String kind, int max) async {
    Object? raw;
    try {
      raw = await store.read('$_prefix$kind.index');
    } on FormatException {
      return _recoverIndex(kind);
    }
    if (raw == null) return [];
    if (raw is! List ||
        raw.length > max ||
        raw.any(
          (e) =>
              e is! String ||
              e.isEmpty ||
              (kind == 'detail' && !isValidNoticeId(e)),
        ) ||
        raw.toSet().length != raw.length) {
      return _recoverIndex(kind);
    }
    return raw.cast<String>().toList();
  }

  Future<List<String>> _recoverIndex(String kind) async {
    // The index is non-authoritative. Discard its entire cache class so orphan
    // entries cannot bypass the finite cache bounds after recovery.
    await store.removePrefix('$_prefix$kind.');
    final label = kind == 'detail' ? '详情' : '列表';
    _cacheWarning = '离线$label缓存索引损坏，已清理并重置；旧离线内容需重新下载。';
    return [];
  }

  Map<String, dynamic> _envelope(Object? value) {
    final r = validatedRecord(value);
    if (r['version'] != 1 || validatedTimestamp(r['savedAt']) == null) {
      throw const DataValidationException('离线缓存版本或时间无效');
    }
    return r;
  }

  Map<String, dynamic> _wrap(Object? value) => {
    'version': 1,
    'savedAt': DateTime.now().toUtc().toIso8601String(),
    'value': value,
  };
  CachedValue<T> _cached<T>(Map<String, dynamic> r, T value) =>
      CachedValue(value, DateTime.parse(r['savedAt'] as String));
  Future<void> _saveCatalog(String kind, Object value) =>
      store.write('$_prefix$kind', _wrap(value));
  Future<CachedValue<List<SourceItem>>?> cachedSources() => _serial(() async {
    final raw = await store.read('${_prefix}sources');
    if (raw == null) return null;
    final r = _envelope(raw);
    return _cached(r, _sourceItems(r['value']));
  });
  Future<CachedValue<List<CategoryItem>>?> cachedCategories() =>
      _serial(() async {
        final raw = await store.read('${_prefix}categories');
        if (raw == null) return null;
        final r = _envelope(raw);
        return _cached(r, _categoryItems(r['value']));
      });

  Future<CachedValue<Notice>?> _readDetail(String id) async {
    validatedNoticeId(id);
    final raw = await store.read('${_prefix}detail.$id');
    if (raw == null) return null;
    final r = _envelope(raw);
    final notice = Notice.fromJson(r['value']);
    if (notice.id != id) throw const DataValidationException('离线详情 ID 不一致');
    return _cached(r, notice);
  }

  Future<CachedValue<Notice>?> cachedDetail(String id) =>
      _serial(() => _readDetail(id));
  Future<void> saveDetail(Notice notice) =>
      _serial(() => _saveDetails([notice]));
  Future<void> _saveDetails(List<Notice> notices) async {
    if (notices.isEmpty) return;
    final index = await _index('detail', 500);
    final changes = <String, Object?>{};
    for (final notice in notices) {
      final value = Notice.fromJson(notice.toJson()).toJson();
      final envelope = _wrap(value);
      if (utf8.encode(jsonEncode(envelope)).length > 2 * 1024 * 1024) {
        throw const DataValidationException('单条通知离线缓存超过 2 MiB');
      }
      index.remove(notice.id);
      index.add(notice.id);
      changes['${_prefix}detail.${notice.id}'] = envelope;
    }
    while (index.length > 500) {
      changes['${_prefix}detail.${index.removeAt(0)}'] = null;
    }
    changes['${_prefix}detail.index'] = index;
    await store.writeAll(changes);
  }

  Future<CachedValue<NoticePage>?> _readFeed(String key) async {
    final raw = await store.read('${_prefix}feed.$key');
    if (raw == null) return null;
    final r = _envelope(raw);
    final page = NoticePage.fromJson(r['value']);
    if (page.invalidItemCount != 0) {
      throw const DataValidationException('离线列表含无效通知');
    }
    final invalid = validatedCount(r['invalidItemCount']);
    final count = validatedCount(r['rawItemCount']);
    if (count < page.items.length + invalid) {
      throw const DataValidationException('离线列表分页计数损坏');
    }
    return _cached(
      r,
      NoticePage(
        items: page.items,
        total: page.total,
        nextCursor: page.nextCursor,
        invalidItemCount: invalid,
        rawItemCount: count,
      ),
    );
  }

  Future<CachedValue<NoticePage>?> cachedFeed(NoticeQuery query) =>
      _serial(() => _readFeed(query.cacheKey));
  Future<void> saveFeed(NoticeQuery query, NoticePage page) =>
      _serial(() async {
        final key = query.cacheKey;
        final validated = NoticePage.fromJson(page.toJson());
        if (validated.invalidItemCount != 0 ||
            page.invalidItemCount < 0 ||
            page.rawItemCount < page.items.length + page.invalidItemCount) {
          throw const DataValidationException('离线列表内容或分页计数无效');
        }
        final envelope = _wrap(validated.toJson())
          ..['invalidItemCount'] = page.invalidItemCount
          ..['rawItemCount'] = page.rawItemCount;
        if (utf8.encode(jsonEncode(envelope)).length > 8 * 1024 * 1024) {
          throw const DataValidationException('通知列表离线缓存超过 8 MiB');
        }
        final index = await _index('feed', 20);
        index.remove(key);
        index.add(key);
        final changes = <String, Object?>{'${_prefix}feed.$key': envelope};
        while (index.length > 20) {
          changes['${_prefix}feed.${index.removeAt(0)}'] = null;
        }
        changes['${_prefix}feed.index'] = index;
        await store.writeAll(changes);
      });

  Future<List<Notice>> cachedNotices() => _serial(() async {
    final items = <String, Notice>{};
    for (final key in await _index('feed', 20)) {
      final cached = await _readFeed(key);
      if (cached != null) {
        for (final item in cached.value.items) {
          items[item.id] = item;
        }
      }
    }
    for (final id in await _index('detail', 500)) {
      final cached = await _readDetail(id);
      if (cached != null) items[id] = cached.value;
    }
    return List.unmodifiable(items.values);
  });

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    if (_ownsClient) _client.close();
  }
}
