import 'dart:async';

import 'package:flutter/material.dart';

import '../app.dart';
import '../data/models.dart';
import '../state/notice_feed.dart';
import '../ui/common.dart';
import '../ui/deadline_notice_bar.dart';
import '../ui/notice_card.dart';
import 'detail.dart';

class FeedScreen extends StatefulWidget {
  const FeedScreen({super.key, required this.services});
  final AppServices services;
  @override
  State<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends State<FeedScreen> {
  late final NoticeFeed feed;
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  List<DeadlineEntry> _deadlines = [];
  String? _ddlError;
  int _ddlGeneration = 0;
  String _sourceKey = '';

  @override
  void initState() {
    super.initState();
    feed = NoticeFeed(widget.services.repository, widget.services.settings);
    _scroll.addListener(_loadNearEnd);
    widget.services.settings.addListener(_settingsChanged);
    unawaited(feed.refresh(useCache: true));
    unawaited(_loadOverview());
  }

  void _loadNearEnd() {
    if (_scroll.hasClients &&
        _scroll.position.extentAfter < 500 &&
        feed.error == null &&
        !feed.scanPaused) {
      unawaited(feed.loadMore());
    }
  }

  void _settingsChanged() {
    final p = widget.services.settings.value;
    final key = '${p.subscriptionMode}:${p.subscribedDepts.join('|')}';
    if (key != _sourceKey) unawaited(_loadOverview());
  }

  Future<void> _loadOverview() async {
    final sequence = ++_ddlGeneration;
    final p = widget.services.settings.value;
    _sourceKey = '${p.subscriptionMode}:${p.subscribedDepts.join('|')}';
    final repository = widget.services.repository;
    try {
      final entries = await repository.deadlines(
        days: 3,
        sources: p.subscriptionMode == 'custom' ? p.subscribedDepts : const [],
        pageSize: 10,
      );
      if (mounted && sequence == _ddlGeneration) {
        setState(() {
          _deadlines = entries;
          _ddlError = null;
        });
      }
    } catch (error) {
      if (mounted && sequence == _ddlGeneration) {
        setState(() => _ddlError = '近期截止通知加载失败：$error');
      }
    }
  }

  Future<void> _refresh() => Future.wait([feed.refresh(), _loadOverview()]);
  @override
  void dispose() {
    _ddlGeneration++;
    _debounce?.cancel();
    widget.services.settings.removeListener(_settingsChanged);
    feed.dispose();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _filter() async {
    _debounce?.cancel();
    final result = await Navigator.push<Object>(
      context,
      MaterialPageRoute(
        builder: (_) => _FilterScreen(
          services: widget.services,
          filters: feed.filters ?? FeedFilters(keyword: _search.text),
        ),
      ),
    );
    if (!mounted || result == null) return;
    if (result == 'reset') {
      _search.clear();
      await feed.apply(null);
    }
    if (result is FeedFilters) {
      _search.text = result.keyword;
      await feed.apply(result);
    }
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 840),
          child: ListenableBuilder(
            listenable: feed,
            builder: (context, _) {
              final visible = feed.visible;
              final p = widget.services.settings.value;
              final deadlines = _deadlines
                  .where(
                    (entry) => !p.blacklistKeywords.any(
                      (word) =>
                          '${entry.title} ${entry.source} ${entry.aiSummary}'
                              .toLowerCase()
                              .contains(word.toLowerCase()),
                    ),
                  )
                  .toList();
              return Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _search,
                            maxLength: 200,
                            textInputAction: TextInputAction.search,
                            decoration: InputDecoration(
                              labelText: '搜索通知',
                              counterText: '',
                              prefixIcon: const Icon(Icons.search),
                              suffixIcon: _search.text.isNotEmpty
                                  ? IconButton(
                                      tooltip: '清空搜索',
                                      icon: const Icon(Icons.close),
                                      onPressed: () {
                                        _debounce?.cancel();
                                        _search.clear();
                                        unawaited(feed.search(''));
                                      },
                                    )
                                  : null,
                            ),
                            onChanged: (text) {
                              _debounce?.cancel();
                              _debounce = Timer(
                                const Duration(milliseconds: 350),
                                () => feed.search(text),
                              );
                            },
                            onSubmitted: (text) {
                              _debounce?.cancel();
                              unawaited(feed.search(text));
                            },
                          ),
                        ),
                        IconButton(
                          tooltip: '高级搜索',
                          isSelected: feed.filters != null,
                          onPressed: _filter,
                          icon: const Icon(Icons.tune),
                        ),
                      ],
                    ),
                  ),
                  if (feed.loading && visible.isNotEmpty)
                    const LinearProgressIndicator(semanticsLabel: '正在更新通知'),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _refresh,
                      child: CustomScrollView(
                        controller: _scroll,
                        physics: const AlwaysScrollableScrollPhysics(),
                        slivers: [
                          SliverToBoxAdapter(
                            child: DeadlineNoticeBar(
                              notices: deadlines,
                              onOpen: (id) => Navigator.push(
                                context,
                                MaterialPageRoute<void>(
                                  builder: (_) => DetailScreen(
                                    services: widget.services,
                                    id: id,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          if (_ddlError != null)
                            SliverToBoxAdapter(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                ),
                                child: ErrorNotice(
                                  message: _ddlError!,
                                  onRetry: _loadOverview,
                                ),
                              ),
                            ),
                          if (feed.filters != null)
                            SliverToBoxAdapter(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                ),
                                child: Align(
                                  alignment: Alignment.centerLeft,
                                  child: InputChip(
                                    label: const Text('高级筛选已启用'),
                                    onDeleted: () {
                                      _search.clear();
                                      unawaited(feed.apply(null));
                                    },
                                    deleteButtonTooltipMessage: '清除高级筛选',
                                  ),
                                ),
                              ),
                            ),
                          if (feed.cacheMessage != null)
                            SliverToBoxAdapter(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(
                                  feed.cacheMessage!,
                                  semanticsLabel: feed.cacheMessage,
                                ),
                              ),
                            ),
                          if (feed.error != null)
                            SliverToBoxAdapter(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                ),
                                child: ErrorNotice(
                                  message: feed.error!,
                                  onRetry: () => feed.refresh(useCache: true),
                                ),
                              ),
                            ),
                          if (feed.invalidItemCount > 0)
                            SliverToBoxAdapter(
                              child: Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(
                                  '已安全跳过 ${feed.invalidItemCount} 条格式异常通知。',
                                ),
                              ),
                            ),
                          if (feed.loading && visible.isEmpty)
                            const SliverToBoxAdapter(child: LoadingView()),
                          SliverList.builder(
                            itemCount: visible.length,
                            itemBuilder: (context, index) => NoticeCard(
                              notice: visible[index],
                              services: widget.services,
                            ),
                          ),
                          if (!feed.loading &&
                              visible.isEmpty &&
                              feed.error == null)
                            SliverToBoxAdapter(
                              child: EmptyNotice(
                                icon: Icons.inbox_outlined,
                                title: feed.finished
                                    ? '没有匹配的通知'
                                    : '已扫描的数据暂无匹配项',
                                message: feed.finished
                                    ? '试试调整来源、分类或关键词。'
                                    : '本地筛选可能需要继续读取后续页面。',
                              ),
                            ),
                          if (!feed.finished &&
                              !feed.loading &&
                              feed.error == null)
                            SliverToBoxAdapter(
                              child: Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(16),
                                  child: OutlinedButton.icon(
                                    onPressed: feed.loadMore,
                                    icon: const Icon(Icons.expand_more),
                                    label: Text(
                                      feed.scanPaused ? '继续查找匹配通知' : '加载更多',
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          if (feed.loading && visible.isNotEmpty)
                            const SliverToBoxAdapter(child: LoadingView()),
                          if (feed.finished && visible.isNotEmpty)
                            const SliverToBoxAdapter(
                              child: Padding(
                                padding: EdgeInsets.all(24),
                                child: Center(child: Text('没有更多通知了')),
                              ),
                            ),
                          const SliverToBoxAdapter(child: SizedBox(height: 24)),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    ),
  );
}

class _FilterScreen extends StatefulWidget {
  const _FilterScreen({required this.services, required this.filters});
  final AppServices services;
  final FeedFilters filters;
  @override
  State<_FilterScreen> createState() => _FilterScreenState();
}

class _FilterScreenState extends State<_FilterScreen> {
  late final TextEditingController _keyword = TextEditingController(
    text: widget.filters.keyword,
  );
  late final TextEditingController _tags = TextEditingController(
    text: widget.filters.tags.join('，'),
  );
  late String? _source = widget.filters.source,
      _type = widget.filters.contentType;
  late final Set<String> _categories = widget.filters.categories.toSet();
  late bool? _deadline = widget.filters.hasDeadline,
      _read = widget.filters.isRead,
      _starred = widget.filters.isStarred;
  late String? _from = widget.filters.dateFrom, _to = widget.filters.dateTo;
  List<SourceItem> _sources = [];
  List<CategoryItem> _catalog = [];
  String? _error;
  bool _loading = true;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final repository = widget.services.repository;
    try {
      final results = await Future.wait<Object>([
        repository.sources(),
        repository.categories(),
      ]);
      if (mounted) {
        setState(() {
          _sources = results[0] as List<SourceItem>;
          _catalog = results[1] as List<CategoryItem>;
        });
      }
    } catch (e) {
      final sources = await repository.cachedSources();
      final categories = await repository.cachedCategories();
      if (mounted) {
        setState(() {
          _sources = sources?.value ?? [];
          _catalog = categories?.value ?? [];
          _error =
              '筛选目录加载失败，${_sources.isNotEmpty || _catalog.isNotEmpty ? '当前显示缓存目录' : '请重试'}：$e';
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _keyword.dispose();
    _tags.dispose();
    super.dispose();
  }

  Future<void> _chooseDates() async {
    final range = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100, 12, 31),
      initialDateRange: _from != null && _to != null
          ? DateTimeRange(
              start: parseDateOnly(_from!),
              end: parseDateOnly(_to!),
            )
          : null,
      helpText: '选择发布日期范围',
    );
    if (range != null && mounted) {
      setState(() {
        _from = dateOnly(range.start);
        _to = dateOnly(range.end);
      });
    }
  }

  Widget _triState(String label, bool? value, ValueChanged<bool?> changed) =>
      DropdownButtonFormField<String>(
        initialValue: value == null
            ? 'any'
            : value
            ? 'yes'
            : 'no',
        decoration: InputDecoration(labelText: label),
        items: const [
          DropdownMenuItem(value: 'any', child: Text('不限')),
          DropdownMenuItem(value: 'yes', child: Text('是')),
          DropdownMenuItem(value: 'no', child: Text('否')),
        ],
        onChanged: (v) => changed(v == 'any' ? null : v == 'yes'),
      );
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('高级搜索'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, 'reset'),
          child: const Text('重置'),
        ),
      ],
    ),
    body: SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              TextField(
                controller: _keyword,
                maxLength: 200,
                decoration: const InputDecoration(labelText: '关键词'),
              ),
              const SizedBox(height: 16),
              if (_loading)
                const LinearProgressIndicator(semanticsLabel: '正在加载筛选目录'),
              if (_error != null) ErrorNotice(message: _error!, onRetry: _load),
              DropdownButtonFormField<String>(
                initialValue: _source ?? '',
                isExpanded: true,
                decoration: const InputDecoration(labelText: '来源'),
                items: [
                  const DropdownMenuItem(value: '', child: Text('全部订阅来源')),
                  for (final name in {
                    ..._sources.map((source) => source.name),
                    ?_source,
                  })
                    DropdownMenuItem(
                      value: name,
                      child: Text(name, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (value) =>
                    setState(() => _source = value == '' ? null : value),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                initialValue: _type ?? '',
                decoration: const InputDecoration(labelText: '内容类型'),
                items: [
                  const DropdownMenuItem(value: '', child: Text('全部（含未分析）')),
                  for (final type in contentTypeNames.entries)
                    DropdownMenuItem(value: type.key, child: Text(type.value)),
                ],
                onChanged: (value) =>
                    setState(() => _type = value == '' ? null : value),
              ),
              const SizedBox(height: 20),
              Text('通知分类', style: Theme.of(context).textTheme.titleMedium),
              const Text('多选为“或”；不选表示全部，临时覆盖长期分类偏好。'),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: [
                  for (final category in _catalog)
                    FilterChip(
                      label: Text(category.name),
                      selected: _categories.contains(category.key),
                      onSelected: (checked) => setState(() {
                        if (checked) {
                          _categories.add(category.key);
                        } else {
                          _categories.remove(category.key);
                        }
                      }),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('发布日期范围'),
                subtitle: Text(_from == null ? '不限' : '$_from 至 $_to'),
                onTap: _chooseDates,
                trailing: _from == null
                    ? const Icon(Icons.date_range)
                    : IconButton(
                        tooltip: '清除日期范围',
                        onPressed: () => setState(() {
                          _from = null;
                          _to = null;
                        }),
                        icon: const Icon(Icons.clear),
                      ),
              ),
              const SizedBox(height: 16),
              _triState('具有截止日期', _deadline, (value) => _deadline = value),
              const SizedBox(height: 16),
              _triState('已读', _read, (value) => _read = value),
              const SizedBox(height: 16),
              _triState('已收藏', _starred, (value) => _starred = value),
              const SizedBox(height: 16),
              TextField(
                controller: _tags,
                maxLength: 1000,
                decoration: const InputDecoration(
                  labelText: '标签筛选',
                  helperText: '用逗号分隔；通知须同时包含这些标签。',
                ),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                icon: const Icon(Icons.search),
                label: const Text('搜索'),
                onPressed: () => Navigator.pop(
                  context,
                  FeedFilters(
                    keyword: _keyword.text.trim(),
                    source: _source,
                    contentType: _type,
                    categories: _categories.toList(),
                    dateFrom: _from,
                    dateTo: _to,
                    hasDeadline: _deadline,
                    isRead: _read,
                    isStarred: _starred,
                    tags: _tags.text
                        .split(RegExp('[,，]'))
                        .map((s) => s.trim())
                        .where((s) => s.isNotEmpty)
                        .toSet()
                        .toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
