import '../data/models.dart';

String? noticeIdFromUri(Uri uri, {required String webBaseUrl}) {
  if (uri.userInfo.isNotEmpty) return null;
  List<String> segments;
  if (uri.scheme == 'notifai' &&
      uri.host == 'detail' &&
      !uri.hasQuery &&
      !uri.hasFragment) {
    segments = uri.pathSegments.where((part) => part.isNotEmpty).toList();
    return segments.length == 1 && isValidNoticeId(segments.first)
        ? segments.first
        : null;
  }
  final web = Uri.tryParse(webBaseUrl);
  if (web == null ||
      uri.scheme != 'https' ||
      uri.host != web.host ||
      uri.port != web.port) {
    return null;
  }
  if (uri.fragment.isNotEmpty) {
    final fragment = Uri.tryParse(uri.fragment);
    if (fragment == null || fragment.hasAuthority || fragment.hasQuery) {
      return null;
    }
    segments = fragment.pathSegments.where((part) => part.isNotEmpty).toList();
  } else {
    segments = uri.pathSegments.where((part) => part.isNotEmpty).toList();
    final prefix = web.pathSegments.where((part) => part.isNotEmpty).toList();
    if (segments.length < prefix.length ||
        List.generate(
          prefix.length,
          (i) => segments[i] == prefix[i],
        ).contains(false)) {
      return null;
    }
    segments = segments.skip(prefix.length).toList();
  }
  if (segments.length != 2 ||
      !{'detail', 'n'}.contains(segments.first) ||
      !isValidNoticeId(segments.last)) {
    return null;
  }
  return segments.last;
}
