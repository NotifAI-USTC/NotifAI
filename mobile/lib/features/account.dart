import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/account_api.dart';
import '../state/account.dart';

class AccountPanel extends StatefulWidget {
  const AccountPanel({
    super.key,
    required this.account,
    this.disabled = false,
    this.allowLogin = true,
  });

  final AccountController account;
  final bool disabled;
  final bool allowLogin;

  @override
  State<AccountPanel> createState() => _AccountPanelState();
}

class _AccountPanelState extends State<AccountPanel> {
  bool _working = false;
  String? _error;

  AccountController get _account => widget.account;
  bool get _blocked => widget.disabled || _account.busy || _working;

  Future<void> _run(Future<void> Function() action, String errorMessage) async {
    if (_blocked) return;
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await action();
    } catch (_) {
      if (mounted) setState(() => _error = errorMessage);
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _signOut() async {
    final user = _account.user;
    if (_account.hasUnsynced &&
        !await _confirm('退出登录？', '尚未同步的修改可能丢失。', '确认退出')) {
      return;
    }
    if (!mounted || user?.id != _account.user?.id) return;
    await _run(_account.signOut, '退出登录失败，请重试');
  }

  Future<void> _overwrite() async {
    final user = _account.user;
    if (!await _confirm('覆盖云端设置？', '此操作会用当前本机偏好替换已读取的云端版本。', '确认覆盖')) {
      return;
    }
    if (!mounted ||
        user?.id != _account.user?.id ||
        _account.status != AccountStatus.conflict ||
        !_account.canOverwrite) {
      return;
    }
    await _run(_account.overwriteCloud, '覆盖云端设置失败，请重试');
  }

  Future<bool> _confirm(String title, String message, String label) async =>
      await showAdaptiveDialog<bool>(
        context: context,
        builder: (context) => AlertDialog.adaptive(
          title: Text(title),
          content: Text(message),
          scrollable: true,
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            TextButton(
              style: TextButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
              ),
              onPressed: () => Navigator.pop(context, true),
              child: Text(label),
            ),
          ],
        ),
      ) ??
      false;

  void _openLogin() {
    setState(() => _error = null);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _AccountLoginDialog(account: _account),
    );
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: _account,
    builder: (context, _) {
      final user = _account.user;
      final status = _account.status;
      final statusLabel = switch (status) {
        AccountStatus.guest => '当前为游客模式',
        AccountStatus.checking => '正在检查登录状态…',
        AccountStatus.unavailable => '暂时无法连接账号服务',
        AccountStatus.loading => '正在读取云端偏好…',
        AccountStatus.synced => '偏好已同步',
        AccountStatus.saving => '正在同步偏好…',
        AccountStatus.dirty => '本机有未同步的修改',
        AccountStatus.conflict => '其他设备已更新云端偏好，请选择要保留的版本。',
      };
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (user != null) ...[
                Text(
                  user.displayName.trim().isEmpty
                      ? user.username ?? 'NotifAI 账号'
                      : user.displayName,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
              ],
              Semantics(liveRegion: true, child: Text(statusLabel)),
              if (_account.notice case final notice?) ...[
                const SizedBox(height: 8),
                Semantics(liveRegion: true, child: Text(notice)),
              ],
              if (_error case final error?) ...[
                const SizedBox(height: 8),
                _AccountError(error),
              ],
              if (_account.busy || _working) ...[
                const SizedBox(height: 12),
                const LinearProgressIndicator(semanticsLabel: '正在处理账号操作'),
              ],
              const SizedBox(height: 12),
              if (status == AccountStatus.unavailable)
                OutlinedButton(
                  onPressed: _blocked
                      ? null
                      : () => _run(_account.restore, '检查登录状态失败，请重试'),
                  child: const Text('重新检查登录状态'),
                ),
              if (user == null) ...[
                FilledButton(
                  onPressed:
                      _blocked ||
                          !widget.allowLogin ||
                          status == AccountStatus.checking
                      ? null
                      : _openLogin,
                  child: const Text('登录 NotifAI'),
                ),
              ] else ...[
                if (status == AccountStatus.dirty)
                  FilledButton.tonal(
                    onPressed: _blocked
                        ? null
                        : () => _run(_account.retrySave, '同步失败，请重试'),
                    child: const Text('重试同步'),
                  ),
                if (status == AccountStatus.conflict) ...[
                  OutlinedButton(
                    onPressed: _blocked
                        ? null
                        : () => _run(_account.useCloudVersion, '读取云端设置失败，请重试'),
                    child: const Text('使用云端版本'),
                  ),
                  OutlinedButton(
                    onPressed: _blocked || !_account.canOverwrite
                        ? null
                        : _overwrite,
                    child: const Text('用本机版本覆盖'),
                  ),
                  if (!_account.canOverwrite)
                    FilledButton.tonal(
                      onPressed: _blocked
                          ? null
                          : () =>
                                _run(_account.refreshConflict, '读取云端设置失败，请重试'),
                      child: const Text('重试读取云端版本'),
                    ),
                ],
                if (status == AccountStatus.synced &&
                    _account.hasImportCandidate &&
                    !_account.hasUnsynced) ...[
                  const Text('云端还没有设置。可主动导入本机游客偏好，导入不会删除游客数据。'),
                  const SizedBox(height: 8),
                  FilledButton.tonal(
                    onPressed: _blocked
                        ? null
                        : () => _run(_account.importLocal, '导入失败，请重试'),
                    child: const Text('导入本机偏好'),
                  ),
                ],
                TextButton(
                  onPressed: _blocked ? null : _signOut,
                  style: TextButton.styleFrom(
                    foregroundColor: Theme.of(context).colorScheme.error,
                  ),
                  child: const Text('退出登录'),
                ),
              ],
            ],
          ),
        ),
      );
    },
  );
}

class _AccountError extends StatelessWidget {
  const _AccountError(this.message);

  final String message;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Text(
      message,
      style: TextStyle(color: Theme.of(context).colorScheme.error),
    ),
  );
}

class _AccountLoginDialog extends StatefulWidget {
  const _AccountLoginDialog({required this.account});

  final AccountController account;

  @override
  State<_AccountLoginDialog> createState() => _AccountLoginDialogState();
}

class _AccountLoginDialogState extends State<_AccountLoginDialog> {
  final _form = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  AccountCapabilities? _capabilities;
  String? _error;
  bool _discovering = true;
  bool _submitting = false;
  bool _openingWeb = false;
  bool _showPassword = false;

  bool get _inProgress => _submitting || _openingWeb;
  bool get _blocked => _inProgress || widget.account.busy;

  @override
  void initState() {
    super.initState();
    _discover();
  }

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _discover() async {
    setState(() {
      _discovering = true;
      _error = null;
    });
    try {
      final capabilities = await widget.account.getCapabilities();
      if (mounted) setState(() => _capabilities = capabilities);
    } catch (error) {
      if (!mounted) return;
      final code = error is AccountApiException ? error.code : null;
      setState(
        () => _error = switch (code) {
          'ACCOUNTS_DISABLED' => '此服务未启用账号登录，可以继续使用游客模式。',
          'NETWORK' => '无法连接账号服务，请检查网络连接后重试。',
          _ => '账号登录暂不可用，请稍后重试。',
        },
      );
    } finally {
      if (mounted) setState(() => _discovering = false);
    }
  }

  Future<void> _submit() async {
    if (_blocked ||
        _capabilities?.hasPassword != true ||
        !_form.currentState!.validate()) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await widget.account.signIn(_username.text.trim(), _password.text);
      if (!mounted) return;
      TextInput.finishAutofillContext();
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      _password.clear();
      final code = error is AccountApiException ? error.code : null;
      setState(
        () => _error = switch (code) {
          'INVALID_CREDENTIALS' => '用户名或密码不正确',
          'LOGIN_RATE_LIMITED' => '尝试次数过多，请稍后再试',
          'INVALID_INPUT' => '请检查用户名和密码格式',
          'ACCOUNT_CHANGED' => '当前登录状态已改变，请重新登录',
          _ => '登录失败，请检查网络连接后重试',
        },
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _openWebAccount() async {
    if (_blocked) return;
    setState(() {
      _openingWeb = true;
      _error = null;
    });
    try {
      await widget.account.openWebAccount();
    } catch (_) {
      if (mounted) setState(() => _error = '无法打开网页版，请重试');
    } finally {
      if (mounted) setState(() => _openingWeb = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.account,
    builder: (context, _) => PopScope(
      canPop: !_blocked,
      child: AlertDialog(
        scrollable: true,
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        title: const Text('登录 NotifAI'),
        content: SizedBox(
          width: 360,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_discovering) ...[
                const Text('正在检查可用的登录方式…'),
                const SizedBox(height: 8),
              ] else if (_capabilities?.hasPassword == true) ...[
                const Text('使用维护者分配的 NotifAI 账号，不要输入校园账号密码。'),
                const SizedBox(height: 16),
                AutofillGroup(
                  onDisposeAction: AutofillContextAction.cancel,
                  child: Form(
                    key: _form,
                    child: Column(
                      children: [
                        TextFormField(
                          controller: _username,
                          readOnly: _blocked,
                          autofillHints: const [AutofillHints.username],
                          autocorrect: false,
                          enableSuggestions: false,
                          textInputAction: TextInputAction.next,
                          maxLength: 32,
                          decoration: const InputDecoration(
                            labelText: '用户名',
                            counterText: '',
                          ),
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? '请输入用户名'
                              : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: _password,
                          readOnly: _blocked,
                          autofillHints: const [AutofillHints.password],
                          obscureText: !_showPassword,
                          autocorrect: false,
                          enableSuggestions: false,
                          textInputAction: TextInputAction.done,
                          maxLength: 256,
                          onFieldSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: '密码',
                            counterText: '',
                            suffixIcon: IconButton(
                              tooltip: _showPassword ? '隐藏密码' : '显示密码',
                              onPressed: _blocked
                                  ? null
                                  : () => setState(
                                      () => _showPassword = !_showPassword,
                                    ),
                              icon: Icon(
                                _showPassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                              ),
                            ),
                          ),
                          validator: (value) =>
                              value == null || value.isEmpty ? '请输入密码' : null,
                        ),
                      ],
                    ),
                  ),
                ),
              ] else if (_capabilities != null) ...[
                const Text('当前服务未开放移动端密码登录。'),
              ],
              if (_error case final error?) ...[
                const SizedBox(height: 8),
                _AccountError(error),
              ],
              if (_discovering || _inProgress) ...[
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  semanticsLabel: _discovering
                      ? '正在检查登录方式'
                      : _submitting
                      ? '正在登录'
                      : '正在打开网页版',
                ),
              ],
              if (_capabilities?.hasPassword == true) ...[
                const SizedBox(height: 8),
                FilledButton(
                  onPressed: _blocked ? null : _submit,
                  child: const Text('登录'),
                ),
              ],
              if (!_discovering && _capabilities == null)
                OutlinedButton(
                  onPressed: _blocked ? null : _discover,
                  child: const Text('重试检查登录方式'),
                ),
              if (_capabilities?.hasOidc == true) ...[
                const SizedBox(height: 16),
                const Text('统一身份认证仅可在系统浏览器的网页版完成。网页版登录不会登录本应用。'),
                OutlinedButton(
                  onPressed: _blocked ? null : _openWebAccount,
                  child: const Text('在浏览器打开网页版'),
                ),
              ],
              const SizedBox(height: 8),
              TextButton(
                onPressed: _blocked ? null : () => Navigator.of(context).pop(),
                child: const Text('取消'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
