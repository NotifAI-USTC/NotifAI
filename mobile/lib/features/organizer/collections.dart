part of '../organizer.dart';

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key, required this.services});
  final AppServices services;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: _PageBody(child: _SavedNotices(services: services)),
  );
}

class _SavedNotices extends StatefulWidget {
  const _SavedNotices({
    required this.services,
    this.important = false,
    this.readHistory = false,
  });
  final AppServices services;
  final bool important;
  final bool readHistory;

  @override
  State<_SavedNotices> createState() => _SavedNoticesState();
}

class _SavedNoticesState extends State<_SavedNotices> {
  final Map<String, Notice> _notices = {};
  List<String> _ids = [];
  String? _folder;
  String? _error;
  String? _cacheMessage;
  List<String> _unavailable = [];
  bool _loading = false;
  int _sequence = 0;
  int _displayLimit = 10;

  UserSettings get _settings => widget.services.settings;

  @override
  void initState() {
    super.initState();
    _settings.addListener(_settingsChanged);
    _settingsChanged();
  }

  @override
  void dispose() {
    _sequence++;
    _settings.removeListener(_settingsChanged);
    super.dispose();
  }

  void _settingsChanged() {
    final ids = widget.important
        ? _settings.value.importantIds
        : widget.readHistory
        ? _settings.value.readIds
        : _settings.value.starredIds;
    final changed =
        ids.length != _ids.length ||
        Iterable<int>.generate(ids.length)
            .any((index) => ids[index] != _ids[index]);
    if (_folder != null &&
        !_settings.value.folders.any((folder) => folder.id == _folder)) {
      _folder = null;
    }
    if (changed) {
      _ids = [...ids];
      _load();
    } else if (mounted) {
      setState(() {});
    }
  }

  Future<void> _load() async {
    final request = ++_sequence;
    final ids = [..._ids];
    setState(() {
      _loading = ids.isNotEmpty;
      _error = null;
      _unavailable = [];
      if (ids.isEmpty) _cacheMessage = null;
    });
    if (ids.isEmpty) return;
    final errors = <String>[];
    var cachedCount = 0;
    var staleCount = 0;
    // Read local snapshots first so a cold offline launch still shows saved details.
    for (final id in ids) {
      if (!mounted || request != _sequence) return;
      if (_notices.containsKey(id)) continue;
      try {
        final cached = await widget.services.repository.cachedDetail(id);
        if (!mounted || request != _sequence) return;
        if (cached != null) {
          _notices[id] = cached.value;
          cachedCount++;
          if (cached.stale) staleCount++;
        }
      } catch (error) {
        if (errors.isEmpty) errors.add('读取离线缓存失败：$error');
      }
    }
    if (!mounted || request != _sequence) return;
    setState(() {
      _cacheMessage = cachedCount > 0
          ? '已读取 $cachedCount 条离线缓存${staleCount > 0 ? '，其中 $staleCount 条超过30天' : ''}，正在更新…'
          : null;
    });
    var failed = false;
    final returned = <String>{};
    for (var start = 0; start < ids.length; start += 500) {
      final end = start + 500 < ids.length ? start + 500 : ids.length;
      try {
        final notices = await widget.services.repository.batch(
          ids.sublist(start, end),
        );
        if (!mounted || request != _sequence) return;
        for (final notice in notices) {
          _notices[notice.id] = notice;
          returned.add(notice.id);
        }
        setState(() {});
      } catch (error) {
        failed = true;
        errors.add('加载第 ${start + 1}–$end 条通知失败：$error');
        if (!mounted || request != _sequence) return;
      }
    }
    if (!mounted || request != _sequence) return;
    setState(() {
      _loading = false;
      _error = errors.isEmpty ? null : errors.join('\n');
      _unavailable = ids.where((id) => !_notices.containsKey(id)).toList();
      final preserved = ids
          .where((id) => _notices.containsKey(id) && !returned.contains(id))
          .length;
      _cacheMessage = preserved > 0
          ? '保留 $preserved 条本地内容${failed ? '（网络更新未完成）' : '（接口暂未返回这些通知）'}；缓存可能不是最新${staleCount > 0 ? '，其中 $staleCount 条缓存超过30天' : ''}。'
          : null;
    });
  }

  List<Notice> get _visible {
    final preferences = _settings.value;
    return _ids
        .where(
          (id) =>
              widget.important ||
              widget.readHistory ||
              _folder == null ||
              (preferences.starredFolderMap[id] ?? 'default') == _folder,
        )
        .map((id) => _notices[id])
        .whereType<Notice>()
        .toList();
  }

  Widget _header() {
    final preferences = _settings.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.readHistory)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text('${_ids.length} 条已读记录 · 本机缓存可离线查看'),
          ),
        if (!widget.important && !widget.readHistory) ...[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                label: const Text('全部目录'),
                selected: _folder == null,
                onSelected: (_) => setState(() => _folder = null),
              ),
              for (final folder in preferences.folders)
                ChoiceChip(
                  label: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 240),
                    child: Text(folder.name),
                  ),
                  selected: _folder == folder.id,
                  onSelected: (_) => setState(() => _folder = folder.id),
                ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        if (_loading)
          const LinearProgressIndicator(semanticsLabel: '正在更新已保存通知'),
        if (_error != null)
          ErrorNotice(message: _error!, onRetry: _loading ? null : _load),
        if (_cacheMessage != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(_cacheMessage!),
          ),
        if (_unavailable.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${_unavailable.length} 条通知暂不可用且没有离线详情，原有记录仍保留。'),
                TextButton.icon(
                  onPressed: _loading ? null : _load,
                  icon: const Icon(Icons.refresh),
                  label: const Text('重试加载通知'),
                ),
              ],
            ),
          ),
        if (_ids.isEmpty)
          EmptyNotice(
            icon: widget.important
                ? Icons.flag_outlined
                : widget.readHistory
                ? Icons.history
                : Icons.bookmark_border,
            title: widget.important
                ? '还没有重要截止事项'
                : widget.readHistory
                ? '还没有阅读记录'
                : '还没有收藏',
            message: widget.important
                ? '在通知卡片或详情中标记“重要”，即可在这里集中查看。'
                : widget.readHistory
                ? '打开通知详情后会记录已读状态。'
                : '收藏感兴趣的通知，方便之后查找；已加载的详情可离线阅读。',
          )
        else if (_visible.isEmpty && !_loading)
          EmptyNotice(
            icon: Icons.folder_open_outlined,
            title: _folder != null ? '这个目录暂时没有可显示的收藏' : '暂时无法显示通知',
            message: _folder != null
                ? '可以切换其他目录，或在收藏操作中调整归属。'
                : '记录没有被删除，请重试加载。',
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    if (widget.important) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _header(),
          for (final notice in visible.take(_displayLimit))
            NoticeCard(
              notice: notice,
              services: widget.services,
              onOpen: () => _openNotice(context, widget.services, notice.id),
            ),
          if (visible.length > _displayLimit)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: OutlinedButton(
                onPressed: () => setState(() => _displayLimit += 10),
                child: Text('继续显示重要事项（还有 ${visible.length - _displayLimit} 条）'),
              ),
            ),
          if (_ids.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh),
                label: const Text('刷新重要事项'),
              ),
            ),
        ],
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        itemCount: visible.length + 1,
        itemBuilder: (context, index) => index == 0
            ? _header()
            : NoticeCard(
                notice: visible[index - 1],
                services: widget.services,
                onOpen: () => _openNotice(
                  context,
                  widget.services,
                  visible[index - 1].id,
                ),
              ),
      ),
    );
  }
}

class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key, required this.services});
  final AppServices services;

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _AgendaEvent {
  const _AgendaEvent(
    this.notice,
    this.date, {
    required this.deadline,
    required this.published,
  });
  final CalendarEntry notice;
  final String date;
  final bool deadline;
  final bool published;
}

class _CalendarSnapshot {
  const _CalendarSnapshot(this.entries, this.start, this.end);
  final List<CalendarEntry> entries;
  final DateTime start;
  final DateTime end;
}

class _CalendarScreenState extends State<CalendarScreen> {
  DateTime _anchor = DateTime.now();
  bool _week = false;
  bool _loading = false;
  bool _exporting = false;
  String? _error;
  int _sequence = 0;
  _CalendarSnapshot? _snapshot;
  final Map<String, _CalendarSnapshot> _memory = {};

  DateTime get _start => _week
      ? DateTime(_anchor.year, _anchor.month, _anchor.day - _anchor.weekday + 1)
      : DateTime(_anchor.year, _anchor.month);
  DateTime get _end => _week
      ? DateTime(_start.year, _start.month, _start.day + 6)
      : DateTime(_anchor.year, _anchor.month + 1, 0);

  String _isoWeek(DateTime date) {
    final utc = DateTime.utc(date.year, date.month, date.day);
    final thursday = utc.add(Duration(days: 4 - utc.weekday));
    final first = DateTime.utc(thursday.year, 1, 1);
    final number = ((thursday.difference(first).inDays + 1) / 7).ceil();
    return '${thursday.year}-W${number.toString().padLeft(2, '0')}';
  }

  String _rangeText(DateTime start, DateTime end) =>
      '${dateOnly(start)} — ${dateOnly(end)}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _sequence++;
    super.dispose();
  }

  Future<void> _load() async {
    final request = ++_sequence;
    final start = _start;
    final end = _end;
    final week = _week;
    final key = '${week ? 'week' : 'month'}:${dateOnly(start)}';
    setState(() {
      _loading = true;
      _error = null;
      if (_memory.containsKey(key)) _snapshot = _memory[key];
    });
    try {
      final entries = await widget.services.repository.calendar(
        month: week
            ? null
            : '${start.year}-${start.month.toString().padLeft(2, '0')}',
        week: week ? _isoWeek(start) : null,
      );
      if (!mounted || request != _sequence) return;
      final snapshot = _CalendarSnapshot(entries, start, end);
      setState(() {
        _snapshot = snapshot;
        _memory.remove(key);
        _memory[key] = snapshot;
        if (_memory.length > 12) _memory.remove(_memory.keys.first);
      });
    } catch (error) {
      if (mounted && request == _sequence) setState(() => _error = '$error');
    } finally {
      if (mounted && request == _sequence) setState(() => _loading = false);
    }
  }

  void _move(int delta) {
    setState(() {
      _anchor = _week
          ? DateTime(_anchor.year, _anchor.month, _anchor.day + 7 * delta)
          : DateTime(_anchor.year, _anchor.month + delta, 1);
    });
    _load();
  }

  List<_AgendaEvent> _events(_CalendarSnapshot snapshot) {
    final start = dateOnly(snapshot.start);
    final end = dateOnly(snapshot.end);
    bool visible(String date) =>
        date.compareTo(start) >= 0 && date.compareTo(end) <= 0;
    final events = <_AgendaEvent>[];
    for (final entry in snapshot.entries) {
      final deadline = entry.deadline;
      if (visible(entry.publishDate)) {
        events.add(
          _AgendaEvent(
            entry,
            entry.publishDate,
            deadline: deadline == entry.publishDate,
            published: true,
          ),
        );
      }
      if (deadline != null &&
          deadline != entry.publishDate &&
          visible(deadline)) {
        events.add(
          _AgendaEvent(entry, deadline, deadline: true, published: false),
        );
      }
    }
    events.sort((a, b) {
      final byDate = a.date.compareTo(b.date);
      if (byDate != 0) return byDate;
      if (a.deadline != b.deadline) return a.deadline ? -1 : 1;
      return a.notice.title.compareTo(b.notice.title);
    });
    return events;
  }

  Future<void> _export() async {
    final snapshot = _snapshot;
    if (snapshot == null || _exporting) return;
    setState(() => _exporting = true);
    try {
      await widget.services.actions.exportCalendar(
        snapshot.entries,
        rangeStart: dateOnly(snapshot.start),
        rangeEnd: dateOnly(snapshot.end),
      );
    } catch (error) {
      if (mounted) showMessage(context, '$error', error: true);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Widget _monthGrid(_CalendarSnapshot snapshot, List<_AgendaEvent> events) {
    final first = snapshot.start;
    final count = snapshot.end.day;
    final offset = first.weekday - 1;
    final cells = ((offset + count + 6) ~/ 7) * 7;
    final counts = <String, int>{};
    for (final event in events) {
      counts.update(event.date, (value) => value + 1, ifAbsent: () => 1);
    }
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                for (final day in weekdays)
                  Expanded(child: Center(child: Text(day))),
              ],
            ),
            const SizedBox(height: 8),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 7,
                mainAxisExtent: 62,
              ),
              itemCount: cells,
              itemBuilder: (context, index) {
                final day = index - offset + 1;
                if (day < 1 || day > count) return const SizedBox.shrink();
                final date = dateOnly(DateTime(first.year, first.month, day));
                final number = counts[date] ?? 0;
                final today = date == dateOnly(DateTime.now());
                return Semantics(
                  label: '$date${today ? '，今天' : ''}，$number 项日程',
                  excludeSemantics: true,
                  child: Container(
                    margin: const EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      color: today
                          ? Theme.of(context).colorScheme.primaryContainer
                          : null,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          '$day',
                          style: TextStyle(
                            fontWeight: today
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                        if (number > 0)
                          Text(
                            '$number 项',
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    final events = snapshot == null ? <_AgendaEvent>[] : _events(snapshot);
    final oldRange =
        snapshot != null &&
        (dateOnly(snapshot.start) != dateOnly(_start) ||
            dateOnly(snapshot.end) != dateOnly(_end));
    final grouped = <String, List<_AgendaEvent>>{};
    for (final event in events) {
      grouped.putIfAbsent(event.date, () => []).add(event);
    }
    return Scaffold(
      body: _PageBody(
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 12,
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(value: false, label: Text('月视图')),
                      ButtonSegment(value: true, label: Text('周议程')),
                    ],
                    selected: {_week},
                    onSelectionChanged: (selection) {
                      setState(() => _week = selection.first);
                      _load();
                    },
                  ),
                  OutlinedButton.icon(
                    onPressed: snapshot == null || _loading || _exporting
                        ? null
                        : _export,
                    icon: const Icon(Icons.ios_share),
                    label: Text(_exporting ? '正在导出…' : '导出可见范围 ICS'),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  IconButton(
                    tooltip: _week ? '上一周' : '上一月',
                    onPressed: () => _move(-1),
                    icon: const Icon(Icons.chevron_left),
                  ),
                  Expanded(
                    child: Semantics(
                      liveRegion: true,
                      child: Text(
                        _week
                            ? _rangeText(_start, _end)
                            : '${_start.year}年${_start.month}月',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: _week ? '下一周' : '下一月',
                    onPressed: () => _move(1),
                    icon: const Icon(Icons.chevron_right),
                  ),
                ],
              ),
              Align(
                alignment: Alignment.center,
                child: TextButton(
                  onPressed: () {
                    setState(() => _anchor = DateTime.now());
                    _load();
                  },
                  child: const Text('回到今天'),
                ),
              ),
              if (_loading)
                const LinearProgressIndicator(semanticsLabel: '正在加载日历'),
              if (_error != null)
                ErrorNotice(
                  message: '无法加载当前范围通知：$_error',
                  onRetry: _loading ? null : _load,
                ),
              if (oldRange)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    '以下仍显示上次成功内容：${_rangeText(snapshot.start, snapshot.end)}。导出仅包含下方实际显示的日期范围。',
                  ),
                ),
              if (snapshot != null) ...[
                if (!_week &&
                    !oldRange &&
                    MediaQuery.textScalerOf(context).scale(14) <= 21)
                  _monthGrid(snapshot, events),
                const SizedBox(height: 16),
                Text(
                  '${events.length} 项日程 · 发布与截止分开标识，同日合并',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 16),
                if (events.isEmpty)
                  const EmptyNotice(
                    icon: Icons.event_available_outlined,
                    title: '这个范围没有日程',
                    message: '可以切换其他月份或周，查看发布与截止事项。',
                  ),
                for (final day in grouped.entries) ...[
                  Semantics(
                    header: true,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        '${day.key} · 周${const ['一', '二', '三', '四', '五', '六', '日'][parseDateOnly(day.key).weekday - 1]}',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                  ),
                  for (final event in day.value)
                    Card(
                      child: ListTile(
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        leading: Icon(
                          event.deadline
                              ? Icons.alarm_outlined
                              : Icons.article_outlined,
                          color: event.deadline
                              ? Theme.of(context).colorScheme.secondary
                              : Theme.of(context).colorScheme.primary,
                        ),
                        title: Text(event.notice.title),
                        subtitle: Text(
                          '${event.deadline
                              ? event.published
                                    ? '发布并截止'
                                    : '截止'
                              : '发布'} · ${event.notice.source}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                        onTap: () => _openNotice(
                          context,
                          widget.services,
                          event.notice.id,
                        ),
                      ),
                    ),
                ],
              ] else if (!_loading && _error == null)
                const EmptyNotice(
                  icon: Icons.calendar_month_outlined,
                  title: '尚未加载日历',
                ),
            ],
          ),
        ),
      ),
    );
  }
}
