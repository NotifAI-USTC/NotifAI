part of '../organizer.dart';

class UserScreen extends StatefulWidget {
  const UserScreen({super.key, required this.services});
  final AppServices services;

  @override
  State<UserScreen> createState() => _UserScreenState();
}

class _UserScreenState extends State<UserScreen> {
  bool _busy = false;
  String? _operationError;
  bool _importantOpen = true;
  Future<void> Function()? _retryAction;
  String? _retrySuccess;

  UserSettings get _settings => widget.services.settings;

  @override
  void initState() {
    super.initState();
    _settings.addListener(_changed);
    widget.services.reminders.addListener(_changed);
  }

  @override
  void dispose() {
    _settings.removeListener(_changed);
    widget.services.reminders.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _run(Future<void> Function() action, {String? success}) async {
    if (_busy) return;
    _retryAction = action;
    _retrySuccess = success;
    setState(() {
      _busy = true;
      _operationError = null;
    });
    try {
      await action();
      if (mounted && success != null) showMessage(context, success);
    } catch (error) {
      if (mounted) setState(() => _operationError = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _createFolder() async {
    final name = await askText(
      context,
      title: '新建收藏目录',
      hint: '目录名称',
      maxLength: 20,
    );
    if (!mounted || name == null || name.trim().isEmpty) return;
    await _run(() => _settings.createFolder(name.trim()), success: '收藏目录已创建');
  }

  Future<void> _renameFolder(NoticeFolder folder) async {
    final name = await askText(
      context,
      title: '重命名目录',
      initial: folder.name,
      maxLength: 20,
    );
    if (!mounted ||
        name == null ||
        name.trim().isEmpty ||
        name.trim() == folder.name) {
      return;
    }
    await _run(
      () => _settings.renameFolder(folder.id, name.trim()),
      success: '目录已重命名',
    );
  }

  Future<void> _deleteFolder(NoticeFolder folder) async {
    if (!await _confirm(
      context,
      '删除“${folder.name}”？',
      '目录中的收藏会移入默认收藏，不会取消收藏。',
    )) {
      return;
    }
    if (!mounted) return;
    await _run(
      () => _settings.deleteFolder(folder.id),
      success: '目录已删除，收藏已移至默认目录',
    );
  }

  Future<void> _markCachedRead() async {
    await _run(() async {
      final notices = await widget.services.repository.cachedNotices();
      await _settings.markLoadedRead(notices.map((notice) => notice.id));
      if (mounted) showMessage(context, '已将 ${notices.length} 条缓存通知标为已读');
    });
  }

  Future<void> _clearRead() async {
    if (!await _confirm(context, '清除已读记录？', '清除后，之前读过的通知会恢复为未读。收藏和重要标记不会改变。')) {
      return;
    }
    if (!mounted) return;
    await _run(_settings.clearRead, success: '已读记录已清除');
  }

  Future<void> _resetOnboarding() async {
    if (!await _confirm(
      context,
      '重新设置身份与订阅？',
      '将重新显示四步引导。现有收藏、重要事项、已读记录和目录均保留。',
    )) {
      return;
    }
    if (!mounted) return;
    await _run(() async {
      await _settings.resetOnboarding();
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    });
  }

  Future<void> _setReminders(bool enabled) async {
    await _run(() async {
      final reminders = widget.services.reminders;
      if (enabled && !reminders.permissionGranted) {
        final granted = await reminders.requestPermission();
        if (!granted) throw StateError('未获得系统通知权限，请在系统设置中允许通知后重试。');
      }
      await _settings.update(
        _settings.value.copyWith(notificationEnabled: enabled),
      );
      await reminders.reconcile();
    });
  }

  Future<void> _requestPermission() async {
    await _run(() async {
      final granted = await widget.services.reminders.requestPermission();
      if (!granted) throw StateError('系统通知权限未开启，可前往系统设置允许通知。');
      if (mounted) showMessage(context, '已获得系统通知权限');
    });
  }

  Future<void> _testReminder() async {
    await _run(widget.services.reminders.sendTest, success: '测试通知已交给系统，请查看通知栏');
  }

  IconData _folderIcon(String icon) => switch (icon) {
    r'$star' => Icons.star_outline,
    r'$school' => Icons.school_outlined,
    r'$trophy' => Icons.emoji_events_outlined,
    r'$flask' => Icons.science_outlined,
    r'$domain' => Icons.apartment_outlined,
    _ => Icons.folder_outlined,
  };

  Widget _summary() {
    final value = _settings.value;
    final identity = _identities
        .where((preset) => preset.id == _settings.identity)
        .firstOrNull;
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('你的校园信息工作台', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(
              '无需登录 · 数据保存在本机${identity == null ? '' : ' · ${identity.title}'}',
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 20,
              runSpacing: 12,
              children: [
                Text('收藏 ${value.starredIds.length}'),
                Text('重要 ${value.importantIds.length}'),
                Text('已读 ${value.readIds.length}'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _subscriptions() {
    final value = _settings.value;
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.tune_outlined),
            title: const Text('订阅管理'),
            subtitle: Text(
              '${value.subscriptionMode == 'all' ? '全部来源' : '${value.subscribedDepts.length} 个来源'} · '
              '${value.categoryMode == 'all' ? '全部分类' : '${value.subscribedCategories.length} 个分类'} · '
              '${value.blacklistKeywords.length} 个屏蔽词',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: _busy
                ? null
                : () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          SubscriptionScreen(services: widget.services),
                    ),
                  ),
          ),
          ListTile(
            leading: const Icon(Icons.restart_alt),
            title: const Text('重新进行身份引导'),
            subtitle: const Text('保留收藏、目录与阅读数据'),
            onTap: _busy || _settings.readOnly ? null : _resetOnboarding,
          ),
        ],
      ),
    );
  }

  Widget _folderSection() => _Section(
    '收藏目录',
    description: '删除目录只移动其中的收藏，不会删除通知。',
    child: Card(
      child: Column(
        children: [
          for (final folder in _settings.value.folders)
            ListTile(
              leading: Icon(_folderIcon(folder.icon)),
              title: Text(folder.name),
              subtitle: Text(
                '${_settings.value.starredIds.where((id) => (_settings.value.starredFolderMap[id] ?? 'default') == folder.id).length} 条收藏',
              ),
              trailing: folder.id == 'default'
                  ? const Text('默认')
                  : PopupMenuButton<String>(
                      tooltip: '管理${folder.name}',
                      enabled: !_busy && !_settings.readOnly,
                      onSelected: (action) {
                        if (action == 'rename') {
                          _renameFolder(folder);
                        } else {
                          _deleteFolder(folder);
                        }
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'rename', child: Text('重命名')),
                        PopupMenuItem(value: 'delete', child: Text('删除并移动收藏')),
                      ],
                    ),
            ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: TextButton.icon(
              onPressed: _busy || _settings.readOnly ? null : _createFolder,
              icon: const Icon(Icons.create_new_folder_outlined),
              label: const Text('新建收藏目录'),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _readingSection() => _Section(
    '阅读记录',
    child: Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.manage_search_outlined),
            title: Text('查看已读通知（${_settings.value.readIds.length}）'),
            subtitle: const Text('按阅读记录加载通知，支持离线缓存'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _busy
                ? null
                : () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => Scaffold(
                        appBar: AppBar(title: const Text('已读通知')),
                        body: _PageBody(
                          child: _SavedNotices(
                            services: widget.services,
                            readHistory: true,
                          ),
                        ),
                      ),
                    ),
                  ),
          ),
          ListTile(
            leading: const Icon(Icons.done_all),
            title: const Text('将缓存通知标为已读'),
            subtitle: const Text('仅处理本机实际缓存的通知，不会将服务器所有通知标为已读'),
            onTap: _busy || _settings.readOnly ? null : _markCachedRead,
          ),
          ListTile(
            leading: const Icon(Icons.history),
            title: Text('清除已读记录（${_settings.value.readIds.length}）'),
            subtitle: const Text('收藏和重要标记不受影响'),
            onTap:
                _busy || _settings.readOnly || _settings.value.readIds.isEmpty
                ? null
                : _clearRead,
          ),
        ],
      ),
    ),
  );

  Widget _backupSection() => _Section(
    '备份与恢复',
    description: 'JSON 备份兼容网页版，包含订阅、收藏、目录、标签与阅读记录。导入会替换本机偏好，请先导出备份。',
    child: Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.file_upload_outlined),
            title: const Text('导出偏好备份'),
            subtitle: const Text('通过系统文件选择器保存 JSON 文件'),
            onTap: _busy
                ? null
                : () => _run(
                    () => widget.services.actions.exportPreferences(_settings),
                  ),
          ),
          ListTile(
            leading: const Icon(Icons.file_download_outlined),
            title: const Text('导入偏好备份'),
            subtitle: const Text('选择已有的 NotifAI JSON 文件'),
            onTap: _busy || _settings.readOnly
                ? null
                : () async {
                    if (!await _confirm(
                      context,
                      '导入并替换本机偏好？',
                      '请确认已备份当前设置。文件校验失败时不会覆盖现有数据；取消文件选择不会更改设置。',
                    )) {
                      return;
                    }
                    if (!mounted) return;
                    await _run(
                      () =>
                          widget.services.actions.importPreferences(_settings),
                    );
                  },
          ),
        ],
      ),
    ),
  );

  Widget _reminderSection() {
    final reminders = widget.services.reminders;
    final plans = [...reminders.plans]
      ..sort((a, b) => a.when.compareTo(b.when));
    return _Section(
      '本地截止提醒',
      description: '仅在本机为已知截止通知安排提醒；请在通知详情中选择时间。不是服务器推送，系统权限和省电设置可能影响送达。',
      child: Card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SwitchListTile(
              secondary: const Icon(Icons.notifications_active_outlined),
              title: const Text('启用本地提醒'),
              subtitle: Text(
                !reminders.supported
                    ? '当前平台不支持系统提醒'
                    : reminders.permissionGranted
                    ? '系统通知权限已允许'
                    : '尚未获得系统通知权限',
              ),
              value: _settings.value.notificationEnabled,
              onChanged: _busy || _settings.readOnly || !reminders.supported
                  ? null
                  : _setReminders,
            ),
            if (reminders.error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ErrorNotice(
                  message: reminders.error!,
                  onRetry: _busy ? null : () => _run(reminders.reconcile),
                ),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: _busy || !reminders.supported
                        ? null
                        : _requestPermission,
                    icon: const Icon(Icons.security_outlined),
                    label: const Text('申请通知权限'),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy || !reminders.supported
                        ? null
                        : _testReminder,
                    icon: const Icon(Icons.notification_add_outlined),
                    label: const Text('发送测试通知'),
                  ),
                ],
              ),
            ),
            if (plans.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('尚未安排本地提醒。在有截止日期的通知详情中设置提醒。'),
              ),
            for (final plan in plans)
              ListTile(
                title: Text(plan.title),
                subtitle: Text(
                  '${_localTimestamp(plan.when)} 提醒\n截止 ${plan.deadline}',
                ),
                onTap: () => _openNotice(context, widget.services, plan.id),
                trailing: IconButton(
                  tooltip: '取消${plan.title}的提醒',
                  onPressed: _busy
                      ? null
                      : () => _run(
                          () => reminders.cancel(plan.id),
                          success: '提醒已取消',
                        ),
                  icon: const Icon(Icons.alarm_off_outlined),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _themeSection() => _Section(
    '外观',
    child: RadioGroup<String>(
      groupValue: _settings.value.darkMode,
      onChanged: (value) {
        if (value != null) _run(() => _settings.setTheme(value));
      },
      child: Card(
        child: Column(
          children: [
            for (final choice in const [
              ('auto', '跟随系统', Icons.brightness_auto_outlined),
              ('light', '浅色模式', Icons.light_mode_outlined),
              ('dark', '深色模式', Icons.dark_mode_outlined),
            ])
              RadioListTile<String>(
                value: choice.$1,
                enabled: !_busy && !_settings.readOnly,
                title: Text(choice.$2),
                secondary: Icon(choice.$3),
              ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    body: _PageBody(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          _summary(),
          const SizedBox(height: 24),
          if (_busy) const LinearProgressIndicator(semanticsLabel: '正在保存或处理操作'),
          if (_operationError != null)
            ErrorNotice(
              message: _operationError!,
              onRetry: _busy || _retryAction == null
                  ? null
                  : () => _run(_retryAction!, success: _retrySuccess),
            ),
          if (_settings.error != null) ErrorNotice(message: _settings.error!),
          if (_settings.readOnly)
            const ErrorNotice(message: '本机偏好由更新版本创建，当前只读。请先升级应用，避免覆盖数据。'),
          _Section('订阅与身份', child: _subscriptions()),
          _Section(
            '重要 DDL',
            description: '你标记的重要通知；网络异常时保留已经缓存的内容。',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextButton.icon(
                  onPressed: () =>
                      setState(() => _importantOpen = !_importantOpen),
                  icon: Icon(
                    _importantOpen ? Icons.expand_less : Icons.expand_more,
                  ),
                  label: Text(
                    '${_importantOpen ? '收起' : '展开'}重要事项（${_settings.value.importantIds.length}）',
                  ),
                ),
                if (_importantOpen)
                  _SavedNotices(services: widget.services, important: true),
              ],
            ),
          ),
          _folderSection(),
          _readingSection(),
          _backupSection(),
          _reminderSection(),
          _themeSection(),
          _Section(
            '关于 NotifAI',
            description: '校园通知聚合与 AI 摘要。重要安排请以来源官网原文为准。',
            child: Card(
              child: ListTile(
                leading: const Icon(Icons.feedback_outlined),
                title: const Text('反馈问题与建议'),
                subtitle: const Text('打开项目提供的实际反馈渠道'),
                trailing: const Icon(Icons.open_in_new),
                onTap: _busy
                    ? null
                    : () => _run(widget.services.actions.feedback),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
