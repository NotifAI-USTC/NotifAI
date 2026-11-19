part of '../organizer.dart';

class OnboardingScreen extends StatelessWidget {
  const OnboardingScreen({super.key, required this.services});
  final AppServices services;

  @override
  Widget build(BuildContext context) =>
      _PreferenceEditor(services: services, onboarding: true);
}

class SubscriptionScreen extends StatelessWidget {
  const SubscriptionScreen({super.key, required this.services});
  final AppServices services;

  @override
  Widget build(BuildContext context) =>
      _PreferenceEditor(services: services, onboarding: false);
}

class _IdentityPreset {
  const _IdentityPreset(
    this.id,
    this.title,
    this.description,
    this.icon,
    this.sources,
    this.categories,
  );
  final String id;
  final String title;
  final String description;
  final IconData icon;
  final List<String> sources;
  final List<String> categories;
}

const _identities = [
  _IdentityPreset(
    'freshman',
    '新生',
    '教务、本科招生与瀚海教学信息',
    Icons.school_outlined,
    ['教务处', '本科招生网', '瀚海教学网'],
    [
      'course_selection',
      'exam',
      'scholarship',
      'course_info',
      'campus_event',
      'logistics',
    ],
  ),
  _IdentityPreset(
    'undergraduate',
    '本科生',
    '教务与本科培养信息',
    Icons.menu_book_outlined,
    ['教务处', '质量工程'],
    [
      'course_selection',
      'exam',
      'scholarship',
      'competition',
      'abroad',
      'internship_job',
    ],
  ),
  _IdentityPreset(
    'postgraduate',
    '研究生',
    '研究生培养与科研学术信息',
    Icons.science_outlined,
    ['研究生院'],
    ['academic_lecture', 'research', 'graduation', 'internship_job', 'abroad'],
  ),
  _IdentityPreset(
    'custom',
    '全部',
    '关注所有来源和分类，之后可随时调整',
    Icons.public_outlined,
    [],
    [],
  ),
];

class _PreferenceEditor extends StatefulWidget {
  const _PreferenceEditor({required this.services, required this.onboarding});
  final AppServices services;
  final bool onboarding;

  @override
  State<_PreferenceEditor> createState() => _PreferenceEditorState();
}

class _PreferenceEditorState extends State<_PreferenceEditor> {
  final _scroll = ScrollController();
  final _sourceSearch = TextEditingController();
  final _keyword = TextEditingController();
  List<SourceItem> _sources = [];
  List<CategoryItem> _categories = [];
  List<String> _selectedSources = [];
  List<String> _selectedCategories = [];
  List<String> _keywords = [];
  String _identity = 'freshman';
  String? _catalogError;
  String? _saveError;
  String? _cacheDescription;
  bool _allSources = true;
  bool _allCategories = true;
  bool _loading = true;
  bool _saving = false;
  bool _draftTouched = false;
  int _step = 0;
  int _sequence = 0;

  @override
  void initState() {
    super.initState();
    final preferences = widget.services.settings.value;
    _identity = widget.services.settings.identity;
    if (!_identities.any((preset) => preset.id == _identity)) {
      _identity = 'freshman';
    }
    _allSources = preferences.subscriptionMode == 'all';
    _allCategories = preferences.categoryMode == 'all';
    _selectedSources = [...preferences.subscribedDepts];
    _selectedCategories = [...preferences.subscribedCategories];
    _keywords = [...preferences.blacklistKeywords];
    if (widget.onboarding) {
      final preset = _identities.firstWhere((item) => item.id == _identity);
      _allSources = preset.id == 'custom';
      _allCategories = preset.categories.isEmpty;
      _selectedSources = [...preset.sources];
      _selectedCategories = [...preset.categories];
    }
    _loadCatalogs();
  }

  @override
  void dispose() {
    _sequence++;
    _scroll.dispose();
    _sourceSearch.dispose();
    _keyword.dispose();
    super.dispose();
  }

  Future<void> _loadCatalogs() async {
    final request = ++_sequence;
    setState(() {
      _loading = true;
      _catalogError = null;
    });
    final errors = <String>[];
    final caches = <String>[];
    var sources = _sources;
    var categories = _categories;
    await Future.wait([
      () async {
        try {
          sources = await widget.services.repository.sources();
        } catch (error) {
          errors.add('来源目录：$error');
          if (sources.isEmpty) {
            try {
              final cached = await widget.services.repository.cachedSources();
              if (cached != null) {
                sources = cached.value;
                caches.add(
                  '来源目录缓存于 ${_localTimestamp(cached.savedAt)}${cached.stale ? '（已超过30天）' : ''}',
                );
              }
            } catch (cacheError) {
              errors.add('读取来源缓存：$cacheError');
            }
          } else {
            caches.add('保留上次成功加载的来源目录');
          }
        }
      }(),
      () async {
        try {
          categories = await widget.services.repository.categories();
        } catch (error) {
          errors.add('分类目录：$error');
          if (categories.isEmpty) {
            try {
              final cached = await widget.services.repository
                  .cachedCategories();
              if (cached != null) {
                categories = cached.value;
                caches.add(
                  '分类目录缓存于 ${_localTimestamp(cached.savedAt)}${cached.stale ? '（已超过30天）' : ''}',
                );
              }
            } catch (cacheError) {
              errors.add('读取分类缓存：$cacheError');
            }
          } else {
            caches.add('保留上次成功加载的分类目录');
          }
        }
      }(),
    ]);
    if (!mounted || request != _sequence) return;
    setState(() {
      _sources = sources;
      _categories = categories;
      _loading = false;
      _catalogError = errors.isEmpty ? null : errors.join('\n');
      _cacheDescription = caches.isEmpty ? null : caches.join('\n');
    });
  }

  void _selectPreset(_IdentityPreset preset) {
    setState(() {
      _identity = preset.id;
      _allSources = preset.id == 'custom';
      _allCategories = preset.categories.isEmpty;
      // Keep preset names while offline; only real catalog items are offered as choices.
      _selectedSources = [...preset.sources];
      _selectedCategories = [...preset.categories];
      _draftTouched = true;
    });
  }

  void _changeStep(int step) {
    setState(() => _step = step);
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  void _addKeyword() {
    final text = _keyword.text.trim();
    if (text.isEmpty) return;
    if (_keywords.contains(text)) {
      showMessage(context, '该关键词已添加');
      return;
    }
    if (_keywords.length >= 50) {
      showMessage(context, '最多添加50个屏蔽关键词', error: true);
      return;
    }
    setState(() {
      _keywords.add(text);
      _draftTouched = true;
    });
    _keyword.clear();
  }

  Future<void> _save() async {
    if (_saving) return;
    _addKeyword();
    setState(() {
      _saving = true;
      _saveError = null;
    });
    try {
      final settings = widget.services.settings;
      if (widget.onboarding) {
        await settings.completeOnboarding(
          identity: _identity,
          sources: _allSources ? [] : _selectedSources,
          categories: _allCategories ? [] : _selectedCategories,
          keywords: _keywords,
        );
      } else {
        await settings.update(
          settings.value.copyWith(
            subscriptionMode: _allSources || _selectedSources.isEmpty
                ? 'all'
                : 'custom',
            subscribedDepts: _allSources ? <String>[] : _selectedSources,
            categoryMode: _allCategories || _selectedCategories.isEmpty
                ? 'all'
                : 'custom',
            subscribedCategories: _allCategories
                ? <String>[]
                : _selectedCategories,
            blacklistKeywords: _keywords,
          ),
        );
        if (mounted) {
          showMessage(context, '订阅设置已保存');
          Navigator.of(context).pop();
        }
      }
    } catch (error) {
      if (mounted) setState(() => _saveError = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _identityChoices() => _Section(
    '让重要通知更靠近你',
    description: '选择身份可应用推荐订阅。收藏、已读和已有个人数据不会被清除。',
    child: RadioGroup<String>(
      groupValue: _identity,
      onChanged: (value) {
        if (value != null) {
          _selectPreset(_identities.firstWhere((preset) => preset.id == value));
        }
      },
      child: Column(
        children: [
          for (final preset in _identities)
            Card(
              clipBehavior: Clip.antiAlias,
              child: RadioListTile<String>(
                value: preset.id,
                enabled: !_saving,
                title: Text(preset.title),
                subtitle: Text(preset.description),
                secondary: Icon(preset.icon),
              ),
            ),
          if (!_draftTouched)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: TextButton(
                onPressed: () => _selectPreset(
                  _identities.firstWhere((preset) => preset.id == _identity),
                ),
                child: const Text('应用所选身份的推荐订阅'),
              ),
            ),
        ],
      ),
    ),
  );

  Widget _catalogStatus() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_loading) const LinearProgressIndicator(semanticsLabel: '正在加载订阅目录'),
      if (_catalogError != null)
        ErrorNotice(
          message: _catalogError!,
          onRetry: _loading ? null : _loadCatalogs,
        ),
      if (_cacheDescription != null)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Text(_cacheDescription!),
        ),
    ],
  );

  Widget _sourceChoices({String? group}) {
    final query = _sourceSearch.text.trim().toLowerCase();
    final items = _sources
        .where(
          (item) =>
              (group == null ||
                  (group == '二级学院'
                      ? item.group == '二级学院'
                      : item.group != '二级学院')) &&
              item.name.toLowerCase().contains(query),
        )
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (group != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(group, style: Theme.of(context).textTheme.titleMedium),
          ),
        for (final item in items)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(item.name),
            subtitle: Text('${item.noticeCount} 条通知'),
            value: _allSources || _selectedSources.contains(item.name),
            onChanged: _saving
                ? null
                : (selected) => setState(() {
                    if (_allSources) {
                      _selectedSources = _sources
                          .map((item) => item.name)
                          .toList();
                      _allSources = false;
                    }
                    if (selected == true) {
                      if (!_selectedSources.contains(item.name)) {
                        _selectedSources.add(item.name);
                      }
                    } else {
                      _selectedSources.remove(item.name);
                    }
                    _draftTouched = true;
                  }),
          ),
        if (items.isEmpty && !_loading)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(query.isEmpty ? '当前目录没有${group ?? '来源'}' : '未找到匹配来源'),
          ),
      ],
    );
  }

  Widget _sourcesSection({bool collegeOnly = false}) {
    final known = _sources.map((item) => item.name).toSet();
    final unknown = _selectedSources
        .where((name) => !known.contains(name))
        .toList();
    return _Section(
      collegeOnly ? '选择你的学院' : '选择关注来源',
      description: '已选来源会保留。只有实时目录成功刷新并确认缺少的来源才不参与筛选；离线或仅有缓存时不会据此排除。空选择按全部来源处理。',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _catalogStatus(),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('关注全部来源'),
            value: _allSources,
            onChanged: _saving
                ? null
                : (value) => setState(() {
                    _allSources = value;
                    _draftTouched = true;
                  }),
          ),
          TextField(
            controller: _sourceSearch,
            decoration: const InputDecoration(
              labelText: '搜索部门或学院',
              prefixIcon: Icon(Icons.search),
            ),
            onChanged: (_) => setState(() {}),
          ),
          if (!collegeOnly) _sourceChoices(group: '校级部门'),
          if (collegeOnly || !widget.onboarding) _sourceChoices(group: '二级学院'),
          if (!_allSources && unknown.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Text('当前目录未列出的已选来源（仍保留在订阅中）'),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final name in unknown)
                  InputChip(
                    label: Text(name),
                    onDeleted: _saving
                        ? null
                        : () => setState(() => _selectedSources.remove(name)),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _categoriesSection() {
    final known = _categories.map((item) => item.key).toSet();
    return _Section(
      '关注的通知分类',
      description: '分类与来源同时生效；不选择具体分类时关注全部。',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('关注全部分类'),
            value: _allCategories,
            onChanged: _saving
                ? null
                : (value) => setState(() => _allCategories = value),
          ),
          if (_categories.isEmpty && !_loading)
            const Text('分类目录暂不可用；已有选择会保留，请重试加载目录。'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final item in _categories)
                FilterChip(
                  label: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 260),
                    child: Text(item.name),
                  ),
                  tooltip: '${item.description} · ${item.noticeCount} 条通知',
                  selected:
                      _allCategories || _selectedCategories.contains(item.key),
                  onSelected: _saving
                      ? null
                      : (selected) => setState(() {
                          if (_allCategories) {
                            _selectedCategories = _categories
                                .map((item) => item.key)
                                .toList();
                            _allCategories = false;
                          }
                          if (selected) {
                            if (!_selectedCategories.contains(item.key)) {
                              _selectedCategories.add(item.key);
                            }
                          } else {
                            _selectedCategories.remove(item.key);
                          }
                        }),
                ),
              if (!_allCategories)
                for (final key in _selectedCategories.where(
                  (key) => !known.contains(key),
                ))
                  InputChip(
                    label: Text(categoryNames[key] ?? key),
                    onDeleted: _saving
                        ? null
                        : () => setState(() => _selectedCategories.remove(key)),
                  ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _keywordsSection() => _Section(
    '屏蔽不感兴趣的内容',
    description: '匹配关键词的通知将在信息流中隐藏。最多50个，每个最多200字。',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _keyword,
          maxLength: 200,
          enabled: !_saving,
          decoration: const InputDecoration(
            labelText: '屏蔽关键词',
            hintText: '例如：已毕业年级',
          ),
          onSubmitted: (_) => _addKeyword(),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: _saving ? null : _addKeyword,
            icon: const Icon(Icons.add),
            label: const Text('添加关键词'),
          ),
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final keyword in _keywords)
              InputChip(
                label: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 260),
                  child: Text(keyword),
                ),
                onDeleted: _saving
                    ? null
                    : () => setState(() => _keywords.remove(keyword)),
              ),
          ],
        ),
        if (_keywords.isEmpty) const Text('尚未屏蔽任何关键词'),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final steps = ['选择身份', '关注来源', '学院与分类', '关键词'];
    return Scaffold(
      appBar: AppBar(title: Text(widget.onboarding ? '欢迎使用 NotifAI' : '订阅管理')),
      body: _PageBody(
        child: ListView(
          controller: _scroll,
          padding: const EdgeInsets.all(20),
          children: [
            if (widget.onboarding) ...[
              if (_step == 0 && widget.services.account != null)
                _Section(
                  '已有 NotifAI 账号？',
                  description: '可直接登录并读取云端偏好，无需先完成游客引导。',
                  child: AccountPanel(
                    account: widget.services.account!,
                    disabled: _saving,
                  ),
                ),
              Semantics(
                liveRegion: true,
                child: Text(
                  '第 ${_step + 1} / 4 步 · ${steps[_step]}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              const SizedBox(height: 12),
              LinearProgressIndicator(
                value: (_step + 1) / 4,
                semanticsLabel: '引导进度',
              ),
              const SizedBox(height: 24),
              if (_step == 0) _identityChoices(),
              if (_step == 1) _sourcesSection(),
              if (_step == 2) ...[
                _sourcesSection(collegeOnly: true),
                _categoriesSection(),
              ],
              if (_step == 3) ...[
                _keywordsSection(),
                _Section(
                  '准备就绪',
                  child: Text(
                    '${_allSources || _selectedSources.isEmpty ? '全部来源' : '已选 ${_selectedSources.length} 个来源'} · '
                    '${_allCategories || _selectedCategories.isEmpty ? '全部分类' : '已选 ${_selectedCategories.length} 个分类'}\n'
                    '订阅只用于本机筛选，可随时在“我的”中调整。',
                  ),
                ),
              ],
            ] else ...[
              _sourcesSection(),
              _categoriesSection(),
              _keywordsSection(),
            ],
            if (_saveError != null)
              ErrorNotice(
                message: _saveError!,
                onRetry: _saving ? null : _save,
              ),
            if (widget.services.settings.profileReady && widget.services.settings.readOnly)
              const ErrorNotice(message: '当前设置来自更新版本，处于只读状态，无法保存。请先升级应用。'),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              spacing: 12,
              runSpacing: 12,
              children: [
                if (widget.onboarding && _step > 0)
                  OutlinedButton(
                    onPressed: _saving ? null : () => _changeStep(_step - 1),
                    child: const Text('上一步'),
                  ),
                FilledButton.icon(
                  onPressed: _saving || widget.services.settings.readOnly
                      ? null
                      : widget.onboarding && _step < 3
                      ? () => _changeStep(_step + 1)
                      : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check),
                  label: Text(
                    _saving
                        ? '正在保存…'
                        : widget.onboarding
                        ? (_step < 3 ? '下一步' : '开始使用')
                        : '保存订阅',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
