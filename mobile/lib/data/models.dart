import 'dart:convert';

const Map<String, String> categoryNames = {
  'course_selection': '选课通知',
  'exam': '考试安排',
  'scholarship': '奖学金',
  'academic_lecture': '学术讲座',
  'campus_event': '校园活动',
  'enrollment': '招生信息',
  'course_info': '教学安排',
  'graduation': '毕业相关',
  'internship_job': '实习就业',
  'library': '图书馆通知',
  'admin': '行政通知',
  'research': '科研通知',
  'competition': '竞赛通知',
  'abroad': '国际交流',
  'party': '党建团学',
  'logistics': '后勤服务',
  'other': '其他通知',
};
const Map<String, String> contentTypeNames = {
  'news': '新闻',
  'notice': '通知/公告',
  'public_notice': '公示',
  'other': '其他',
};

class DataValidationException implements Exception {
  const DataValidationException(this.message);
  final String message;
  @override
  String toString() => '通知数据无效：$message';
}

const sourceAliases = {
  '计算机科学与技术学院': '计算机学院',
  '招生办公室': '本科招生网',
  '国际合作与交流部': '国际合作交流',
};

String normalizeSource(String source) => sourceAliases[source] ?? source;

const trustedNoticeHosts = ['ustc.edu.cn', 'ustclug.org'];

bool isTrustedNoticeHost(String host) {
  final value = host.toLowerCase();
  return trustedNoticeHosts.any(
    (domain) => value == domain || value.endsWith('.$domain'),
  );
}

String publishDateLabel(String? value) =>
    value == null || value.isEmpty ? '未知' : value;

int comparePublishDates(String? a, String? b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.compareTo(b);
}

bool isValidNoticeId(Object? value) =>
    value is String &&
    RegExp(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$').hasMatch(value);
String validatedNoticeId(Object? value) {
  if (!isValidNoticeId(value)) {
    throw const DataValidationException('通知 ID 格式无效');
  }
  return value as String;
}

Map<String, dynamic> validatedRecord(Object? value) {
  if (value is! Map<String, dynamic>) {
    throw const DataValidationException('必须是对象');
  }
  return value;
}

String _text(Object? value, String field, int max) {
  if (value is! String || value.isEmpty || value.length > max) {
    throw DataValidationException('$field 长度或类型无效');
  }
  return value;
}

String _optionalText(Object? value, int max) => value is! String
    ? ''
    : value.length > max
    ? value.substring(0, max)
    : value;
int validatedCount(Object? value, {int max = 9007199254740991}) {
  if (value is! num ||
      !value.isFinite ||
      value != value.truncateToDouble() ||
      value < 0 ||
      value > max) {
    throw const DataValidationException('计数必须是有效非负整数');
  }
  return value.toInt();
}

DateTime parseDateOnly(String value) {
  final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(value);
  if (match == null) {
    throw const DataValidationException('日期必须使用 YYYY-MM-DD 格式');
  }
  final y = int.parse(match[1]!);
  final m = int.parse(match[2]!);
  final d = int.parse(match[3]!);
  final result = DateTime(y, m, d);
  if (y < 2000 ||
      y > 2100 ||
      result.year != y ||
      result.month != m ||
      result.day != d) {
    throw const DataValidationException('日期无效，年份须在 2000 到 2100 之间');
  }
  return result;
}

String dateOnly(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
String _date(Object? value) {
  if (value is! String) throw const DataValidationException('日期必须是字符串');
  final input = value.trim();
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}(?:$|[T\s])').hasMatch(input)) {
    throw const DataValidationException('日期格式无效');
  }
  return dateOnly(parseDateOnly(input.substring(0, 10)));
}

String? _optionalDate(Object? value) {
  if (value == null) return null;
  if (value is! String) {
    throw const DataValidationException('publishDate 必须是字符串或 null');
  }
  final trimmed = value.trim();
  if (trimmed.isEmpty) return null;
  return _date(trimmed);
}

int remainingDays(String deadline, {DateTime? now}) {
  final end = parseDateOnly(deadline);
  final today = (now ?? DateTime.now()).toLocal();
  return DateTime.utc(
    end.year,
    end.month,
    end.day,
  ).difference(DateTime.utc(today.year, today.month, today.day)).inDays;
}

String deadlineLabel(String deadline) {
  final days = remainingDays(deadline);
  return days < 0
      ? '已过期'
      : days == 0
      ? '今天截止'
      : '剩 $days 天';
}

String? validatedTimestamp(Object? value) {
  if (value == null) return null;
  if (value is! String ||
      value.length > 100 ||
      !RegExp(
        r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?$',
      ).hasMatch(value)) {
    throw const DataValidationException('必须是 ISO8601 时间字符串或 null');
  }
  final y = int.parse(value.substring(0, 4));
  final m = int.parse(value.substring(5, 7));
  final d = int.parse(value.substring(8, 10));
  final date = DateTime.utc(y, m, d);
  final h = int.parse(value.substring(11, 13));
  final minute = int.parse(value.substring(14, 16));
  final seconds = value.length >= 19 && value[16] == ':'
      ? int.parse(value.substring(17, 19))
      : 0;
  final zone = RegExp(r'[+-](\d{2}):?(\d{2})$').firstMatch(value);
  if (date.year != y ||
      date.month != m ||
      date.day != d ||
      h > 23 ||
      minute > 59 ||
      seconds > 59 ||
      (zone != null &&
          (int.parse(zone[1]!) > 23 || int.parse(zone[2]!) > 59)) ||
      DateTime.tryParse(value) == null) {
    throw const DataValidationException('ISO8601 时间无效');
  }
  return value;
}

String? _contentType(Object? value) {
  if (value == null) return null;
  if (value is! String || !contentTypeNames.containsKey(value)) {
    throw const DataValidationException('不支持的内容类型');
  }
  return value;
}

// Uri normalization discards an empty user-info component, so inspect the
// original authority before parsing. An @ in the path/query is not user-info.
bool hasRawUrlCredentials(String value) =>
    RegExp(r'^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*@').hasMatch(value.trim());

bool isValidHttpUri(Uri uri) {
  try {
    if (!uri.hasAuthority ||
        uri.userInfo.isNotEmpty ||
        uri.authority.contains('@') ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.port < 1 ||
        uri.port > 65535) {
      return false;
    }
    final host = uri.host;
    if (host.startsWith('[') && host.endsWith(']')) {
      return RegExp(r'^\[[0-9a-fA-F:.]+\]$').hasMatch(host);
    }
    if (host.isEmpty || host.length > 253) return false;
    return host
        .split('.')
        .every(
          (label) =>
              label.isNotEmpty &&
              label.length <= 63 &&
              !label.startsWith('-') &&
              !label.endsWith('-') &&
              !RegExp(r'[\s/\\:@?#%\[\]]').hasMatch(label),
        );
  } on FormatException {
    return false;
  }
}

String _url(Object? value, {bool trusted = false}) {
  final text = _text(value, '网址', 4096);
  final uri = hasRawUrlCredentials(text) ? null : Uri.tryParse(text);
  if (uri == null ||
      !isValidHttpUri(uri) ||
      (trusted && (uri.scheme != 'https' || !isTrustedNoticeHost(uri.host)))) {
    throw DataValidationException(
      trusted ? '原文必须是无凭据的中国科大或 LUG HTTPS 地址' : '附件必须是无凭据的 HTTP(S) 地址',
    );
  }
  return uri.toString();
}

String _originUrl(Object? value) {
  if (value == null) return '';
  if (value is! String) {
    throw const DataValidationException('原文网址必须是字符串');
  }
  if (value.trim().isEmpty) return '';
  return _url(value, trusted: true);
}

class NoticeAttachment {
  const NoticeAttachment({required this.name, required this.url});
  final String name, url;
  factory NoticeAttachment.fromJson(Object? json) {
    final r = validatedRecord(json);
    return NoticeAttachment(
      name: _text(r['name'], '附件名', 500),
      url: _url(r['url']),
    );
  }
  Map<String, dynamic> toJson() => {'name': name, 'url': url};
}

class Notice {
  Notice({
    required this.id,
    required this.title,
    required this.source,
    required this.publishDate,
    this.aiSummary = '',
    this.targetAudience = '',
    this.coreAction = '',
    required this.originUrl,
    this.cleanContent = '',
    this.deadline,
    this.contentType,
    this.firstSeen,
    this.lastCrawl,
    List<String> categories = const [],
    List<NoticeAttachment> attachments = const [],
  }) : categories = List.unmodifiable(categories),
       attachments = List.unmodifiable(attachments);
  final String id,
      title,
      source,
      aiSummary,
      targetAudience,
      coreAction,
      originUrl,
      cleanContent;
  final String? publishDate, deadline, contentType, firstSeen, lastCrawl;
  final List<String> categories;
  final List<NoticeAttachment> attachments;
  factory Notice.fromJson(Object? json) {
    final r = validatedRecord(json);
    final rawCategories = r['categories'];
    if (rawCategories is! List ||
        rawCategories.length > 3 ||
        rawCategories.any(
          (c) => c is! String || !categoryNames.containsKey(c),
        ) ||
        rawCategories.toSet().length != rawCategories.length) {
      throw const DataValidationException('分类必须是至多 3 项且不重复的有效分类数组');
    }
    final rawAttachments = r['attachments'] ?? const [];
    if (rawAttachments is! List || rawAttachments.length > 50) {
      throw const DataValidationException('附件必须是至多 50 项的数组');
    }
    return Notice(
      id: validatedNoticeId(r['id']),
      title: _text(r['title'], '标题', 500),
      source: normalizeSource(_text(r['source'], '来源', 200)),
      publishDate: _optionalDate(r['publishDate']),
      categories: rawCategories.cast<String>(),
      contentType: _contentType(r['contentType']),
      aiSummary: _optionalText(r['aiSummary'], 10000),
      deadline: r['deadline'] == null ? null : _date(r['deadline']),
      targetAudience: _optionalText(r['targetAudience'], 2000),
      coreAction: _optionalText(r['coreAction'], 2000),
      originUrl: _originUrl(r['originUrl']),
      cleanContent: _optionalText(r['cleanContent'], 500000),
      attachments: rawAttachments.map(NoticeAttachment.fromJson).toList(),
      firstSeen: validatedTimestamp(r['firstSeen']),
      lastCrawl: validatedTimestamp(r['lastCrawl']),
    );
  }
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'source': source,
    'publishDate': publishDate,
    'categories': categories,
    'contentType': contentType,
    'aiSummary': aiSummary,
    'deadline': deadline,
    'targetAudience': targetAudience,
    'coreAction': coreAction,
    'originUrl': originUrl,
    'cleanContent': cleanContent,
    'attachments': attachments.map((a) => a.toJson()).toList(),
    'firstSeen': firstSeen,
    'lastCrawl': lastCrawl,
  };
}

class ValidatedRows<T> {
  const ValidatedRows(this.items, this.rawItemCount);
  final List<T> items;
  final int rawItemCount;
  int get invalidItemCount => rawItemCount - items.length;
}

ValidatedRows<T> validatedRows<T>(
  Object? value,
  T Function(Object?) parse,
  String Function(T) id, {
  int max = 1000,
}) {
  if (value is! List || value.length > max) {
    throw DataValidationException('items 必须是至多 $max 项的数组');
  }
  final items = <T>[];
  final seen = <String>{};
  for (final raw in value) {
    T parsed;
    try {
      parsed = parse(raw);
    } on DataValidationException {
      continue;
    }
    if (!seen.add(id(parsed))) throw const DataValidationException('存在重复通知 ID');
    items.add(parsed);
  }
  return ValidatedRows(List.unmodifiable(items), value.length);
}

class NoticePage {
  NoticePage({
    required List<Notice> items,
    required this.total,
    this.nextCursor,
    this.invalidItemCount = 0,
    int? rawItemCount,
  }) : items = List.unmodifiable(items),
       rawItemCount = rawItemCount ?? items.length + invalidItemCount;
  final List<Notice> items;
  final int total, invalidItemCount, rawItemCount;
  final String? nextCursor;
  factory NoticePage.fromJson(Object? json) {
    final r = validatedRecord(json);
    final rows = validatedRows(r['items'], Notice.fromJson, (n) => n.id);
    final total = validatedCount(r['total'], max: 10000000);
    if (total < rows.items.length) {
      throw const DataValidationException('总数小于实际通知数量');
    }
    final cursor = r['nextCursor'] == null
        ? null
        : _text(r['nextCursor'], '翻页光标', 4096);
    return NoticePage(
      items: rows.items,
      total: total,
      nextCursor: cursor,
      invalidItemCount: rows.invalidItemCount,
      rawItemCount: rows.rawItemCount,
    );
  }
  Map<String, dynamic> toJson() => {
    'items': items.map((n) => n.toJson()).toList(),
    'total': total,
    'nextCursor': nextCursor,
  };
}

class SourceItem {
  const SourceItem({
    required this.name,
    required this.group,
    required this.noticeCount,
  });
  final String name, group;
  final int noticeCount;
  factory SourceItem.fromJson(Object? json) {
    final r = validatedRecord(json);
    return SourceItem(
      name: normalizeSource(_text(r['name'], '来源名', 200)),
      group: _text(r['group'], '来源分组', 200),
      noticeCount: validatedCount(r['noticeCount']),
    );
  }
  Map<String, dynamic> toJson() => {
    'name': name,
    'group': group,
    'noticeCount': noticeCount,
  };
}

class CategoryItem {
  const CategoryItem({
    required this.key,
    required this.name,
    required this.description,
    required this.noticeCount,
  });
  final String key, name, description;
  final int noticeCount;
  factory CategoryItem.fromJson(Object? json) {
    final r = validatedRecord(json);
    if (!categoryNames.containsKey(r['key'])) {
      throw const DataValidationException('不支持的分类 key');
    }
    return CategoryItem(
      key: r['key'] as String,
      name: _text(r['name'], '分类名称', 200),
      description: _text(r['description'], '分类描述', 2000),
      noticeCount: validatedCount(r['noticeCount']),
    );
  }
  Map<String, dynamic> toJson() => {
    'key': key,
    'name': name,
    'description': description,
    'noticeCount': noticeCount,
  };
}

class CalendarEntry {
  const CalendarEntry({
    required this.id,
    required this.title,
    required this.source,
    required this.publishDate,
    this.deadline,
    this.contentType,
  });
  final String id, title, source;
  final String? publishDate, deadline, contentType;
  factory CalendarEntry.fromJson(Object? json) {
    final r = validatedRecord(json);
    return CalendarEntry(
      id: validatedNoticeId(r['id']),
      title: _text(r['title'], '标题', 500),
      source: normalizeSource(_text(r['source'], '来源', 200)),
      publishDate: _optionalDate(r['publishDate']),
      deadline: r['deadline'] == null ? null : _date(r['deadline']),
      contentType: _contentType(r['contentType']),
    );
  }
  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'source': source,
    'publishDate': publishDate,
    'deadline': deadline,
    'contentType': contentType,
  };
}

class DeadlineEntry extends CalendarEntry {
  const DeadlineEntry({
    required super.id,
    required super.title,
    required super.source,
    required super.publishDate,
    required String deadline,
    super.contentType,
    this.aiSummary = '',
    this.targetAudience = '',
  }) : super(deadline: deadline);
  final String aiSummary, targetAudience;
  @override
  String get deadline => super.deadline!;
  factory DeadlineEntry.fromJson(Object? json) {
    final r = validatedRecord(json);
    final entry = CalendarEntry.fromJson(r);
    return DeadlineEntry(
      id: entry.id,
      title: entry.title,
      source: entry.source,
      publishDate: entry.publishDate,
      deadline: _date(r['deadline']),
      contentType: entry.contentType,
      aiSummary: _optionalText(r['aiSummary'], 10000),
      targetAudience: _optionalText(r['targetAudience'], 2000),
    );
  }
  @override
  Map<String, dynamic> toJson() => {
    ...super.toJson(),
    'aiSummary': aiSummary,
    'targetAudience': targetAudience,
  };
}

class CalendarResult {
  const CalendarResult({
    required this.entries,
    required this.total,
    required this.truncated,
  });
  final List<CalendarEntry> entries;
  final int total;
  final bool truncated;
  factory CalendarResult.fromJson(Object? json) {
    final r = validatedRecord(json);
    final rows = validatedRows(r['items'], CalendarEntry.fromJson, (n) => n.id);
    final total = r['total'] == null
        ? rows.items.length
        : validatedCount(r['total'], max: 10000000);
    if (total < rows.items.length) {
      throw const DataValidationException('日历总数小于实际通知数量');
    }
    if (r['truncated'] != null && r['truncated'] is! bool) {
      throw const DataValidationException('日历截断标记必须是布尔值');
    }
    return CalendarResult(
      entries: rows.items,
      total: total,
      truncated: r['truncated'] == true,
    );
  }
}

class Stats {
  const Stats({
    required this.total,
    required this.sourceCount,
    required this.last7DaysDdl,
    required this.last24hNew,
    this.lastCrawlAt,
  });
  final int total, sourceCount, last7DaysDdl, last24hNew;
  final String? lastCrawlAt;
  factory Stats.fromJson(Object? json) {
    final r = validatedRecord(json);
    int count(String key) {
      try {
        return validatedCount(r[key]);
      } on DataValidationException {
        return 0;
      }
    }

    String? crawl;
    if (r['lastCrawlAt'] != null) {
      final value = r['lastCrawlAt'];
      if (value is! String || value.length > 100) {
        throw const DataValidationException('最近抓取时间必须是字符串');
      }
      try {
        crawl = validatedTimestamp(value);
      } on DataValidationException {
        crawl = null;
      }
    }
    return Stats(
      total: count('total'),
      sourceCount: count('sourceCount'),
      last7DaysDdl: count('last7DaysDdl'),
      last24hNew: count('last24hNew'),
      lastCrawlAt: crawl,
    );
  }
}

const _unchanged = Object();

class NoticeQuery {
  NoticeQuery({
    this.keyword,
    String? source,
    this.contentType,
    this.dateFrom,
    this.dateTo,
    List<String> sources = const [],
    List<String> categories = const [],
    List<String> excludeIds = const [],
    this.hasDeadline,
    this.cursor,
    this.page = 1,
    this.pageSize = 15,
    this.light = true,
  }) : source = source == null ? null : normalizeSource(source),
       sources = List.unmodifiable(sources.map(normalizeSource)),
       categories = List.unmodifiable(categories),
       excludeIds = List.unmodifiable(excludeIds);
  final String? keyword, source, contentType, dateFrom, dateTo, cursor;
  final List<String> sources, categories, excludeIds;
  final bool? hasDeadline;
  final int page, pageSize;
  final bool light;
  Map<String, dynamic> toParameters() {
    if (page < 1 ||
        page > 9007199254740991 ||
        pageSize < 1 ||
        pageSize > 1000) {
      throw const DataValidationException('page 或 pageSize 超出有效范围');
    }
    if (sources.length > 100 ||
        categories.length > 17 ||
        excludeIds.length > 500) {
      throw const DataValidationException('查询数组长度超限');
    }
    final params = <String, dynamic>{
      'page': '$page',
      'pageSize': '$pageSize',
      'light': '$light',
    };
    if (keyword != null) params['keyword'] = _text(keyword, '关键词', 200);
    if (source != null) {
      params['source'] = normalizeSource(_text(source, '来源', 200));
    }
    if (contentType != null) params['contentType'] = _contentType(contentType)!;
    if (dateFrom != null) params['dateFrom'] = _date(dateFrom);
    if (dateTo != null) params['dateTo'] = _date(dateTo);
    if (dateFrom != null &&
        dateTo != null &&
        (params['dateFrom'] as String).compareTo(params['dateTo'] as String) >
            0) {
      throw const DataValidationException('起始日期不能晚于结束日期');
    }
    if (cursor != null) params['cursor'] = _text(cursor, '光标', 4096);
    if (hasDeadline != null) params['hasDeadline'] = '$hasDeadline';
    if (sources.isNotEmpty) {
      params['sources[]'] = sources
          .map((s) => normalizeSource(_text(s, '来源', 200)))
          .toSet()
          .toList();
    }
    if (categories.any((c) => !categoryNames.containsKey(c))) {
      throw const DataValidationException('查询分类无效');
    }
    if (categories.isNotEmpty) {
      params['categories[]'] = categories.toSet().toList();
    }
    final ids = excludeIds
        .where((id) => id.isNotEmpty)
        .map(validatedNoticeId)
        .toSet()
        .toList();
    if (ids.isNotEmpty) params['excludeIds[]'] = ids;
    return params;
  }

  String get cacheKey {
    final params = toParameters()
      ..remove('page')
      ..remove('cursor');
    for (final key in ['sources[]', 'categories[]', 'excludeIds[]']) {
      if (params[key] is List<String>) (params[key] as List<String>).sort();
    }
    return jsonEncode(params);
  }

  NoticeQuery copyWith({
    Object? keyword = _unchanged,
    Object? source = _unchanged,
    Object? contentType = _unchanged,
    Object? dateFrom = _unchanged,
    Object? dateTo = _unchanged,
    List<String>? sources,
    List<String>? categories,
    List<String>? excludeIds,
    Object? hasDeadline = _unchanged,
    Object? cursor = _unchanged,
    int? page,
    int? pageSize,
    bool? light,
  }) => NoticeQuery(
    keyword: identical(keyword, _unchanged) ? this.keyword : keyword as String?,
    source: identical(source, _unchanged) ? this.source : source as String?,
    contentType: identical(contentType, _unchanged)
        ? this.contentType
        : contentType as String?,
    dateFrom: identical(dateFrom, _unchanged)
        ? this.dateFrom
        : dateFrom as String?,
    dateTo: identical(dateTo, _unchanged) ? this.dateTo : dateTo as String?,
    sources: sources ?? this.sources,
    categories: categories ?? this.categories,
    excludeIds: excludeIds ?? this.excludeIds,
    hasDeadline: identical(hasDeadline, _unchanged)
        ? this.hasDeadline
        : hasDeadline as bool?,
    cursor: identical(cursor, _unchanged) ? this.cursor : cursor as String?,
    page: page ?? this.page,
    pageSize: pageSize ?? this.pageSize,
    light: light ?? this.light,
  );
}
