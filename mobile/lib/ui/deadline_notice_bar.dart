import 'package:flutter/material.dart';

import '../data/models.dart';

/// Same three-day window and mobile paging behavior as the Web DDL banner.
class DeadlineNoticeBar extends StatefulWidget {
  const DeadlineNoticeBar({
    super.key,
    required this.notices,
    required this.onOpen,
    this.now,
  });
  final List<DeadlineEntry> notices;
  final ValueChanged<String> onOpen;
  final DateTime? now;

  @override
  State<DeadlineNoticeBar> createState() => _DeadlineNoticeBarState();
}

class _DeadlineNoticeBarState extends State<DeadlineNoticeBar> {
  final _pages = PageController();
  int _index = 0;
  double? _lastWidth;

  List<DeadlineEntry> get _urgent => widget.notices.where((notice) {
    final days = remainingDays(notice.deadline, now: widget.now);
    return days >= 0 && days <= 3;
  }).toList()..sort((a, b) => a.deadline.compareTo(b.deadline));

  @override
  void didUpdateWidget(DeadlineNoticeBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    final count = _urgent.length;
    final next = count == 0 ? 0 : _index.clamp(0, count - 1);
    if (next != _index) {
      _index = next;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _pages.hasClients) _pages.jumpToPage(_index);
      });
    }
  }

  void _go(int index) {
    final count = _urgent.length;
    if (count == 0) return;
    final next = index.clamp(0, count - 1);
    setState(() => _index = next);
    if (_pages.hasClients) _pages.jumpToPage(next);
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  String _remaining(DeadlineEntry notice) {
    final days = remainingDays(notice.deadline, now: widget.now);
    return days == 0 ? '今天截止' : '剩 $days 天';
  }

  Widget _entry(BuildContext context, DeadlineEntry notice) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      onTap: () => widget.onOpen(notice.id),
      label: '查看紧急通知：${notice.title}，${notice.source}，${_remaining(notice)}',
      excludeSemantics: true,
      child: Tooltip(
        message: '${notice.title}\n${notice.source} · ${notice.deadline}',
        child: InkWell(
          onTap: () => widget.onOpen(notice.id),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              children: [
                Icon(Icons.alarm, size: 20, color: colors.onSecondaryContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        notice.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              notice.source,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ),
                          const Text(' · '),
                          Text(
                            _remaining(notice),
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(
                                  fontWeight: FontWeight.w600,
                                  color:
                                      remainingDays(
                                            notice.deadline,
                                            now: widget.now,
                                          ) ==
                                          0
                                      ? colors.error
                                      : colors.onSecondaryContainer,
                                ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _pager(int count) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      IconButton(
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        tooltip: '上一条紧急 DDL',
        onPressed: _index == 0 ? null : () => _go(_index - 1),
        icon: const Icon(Icons.chevron_left),
      ),
      Semantics(
        liveRegion: true,
        label: '紧急 DDL，第 ${_index + 1} 条，共 $count 条',
        child: ExcludeSemantics(child: Text('${_index + 1}/$count')),
      ),
      IconButton(
        constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
        tooltip: '下一条紧急 DDL',
        onPressed: _index >= count - 1 ? null : () => _go(_index + 1),
        icon: const Icon(Icons.chevron_right),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final notices = _urgent;
    if (notices.isEmpty) return const SizedBox.shrink();
    final colors = Theme.of(context).colorScheme;
    final scaler = MediaQuery.textScalerOf(context);
    final height = 24 + scaler.scale(14) * 1.5 + scaler.scale(12) * 1.6;
    return Card.filled(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      color: colors.secondaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: LayoutBuilder(
          builder: (context, constraints) {
            if (_lastWidth != constraints.maxWidth) {
              _lastWidth = constraints.maxWidth;
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (mounted && _pages.hasClients) _pages.jumpToPage(_index);
              });
            }
            if (MediaQuery.sizeOf(context).width >= 960) {
              return Row(
                children: [
                  const Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    child: Text('紧急 DDL'),
                  ),
                  Expanded(
                    child: SizedBox(
                      height: height,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: notices.length,
                        separatorBuilder: (_, index) =>
                            const VerticalDivider(width: 8),
                        itemBuilder: (context, index) => SizedBox(
                          width: 320,
                          child: _entry(context, notices[index]),
                        ),
                      ),
                    ),
                  ),
                ],
              );
            }
            final pages = SizedBox(
              height: height,
              child: PageView.builder(
                controller: _pages,
                itemCount: notices.length,
                onPageChanged: (index) {
                  if (index != _index) setState(() => _index = index);
                },
                itemBuilder: (context, index) =>
                    _entry(context, notices[index]),
              ),
            );
            // Large text and narrow phones need a separate control row, not smaller
            // hit targets or a deadline squeezed out by the source label.
            if (constraints.maxWidth < 320 || scaler.scale(14) > 20) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  pages,
                  if (notices.length > 1)
                    Align(
                      alignment: Alignment.centerRight,
                      child: _pager(notices.length),
                    ),
                ],
              );
            }
            return Row(
              children: [
                Expanded(child: pages),
                if (notices.length > 1) _pager(notices.length),
              ],
            );
          },
        ),
      ),
    );
  }
}
