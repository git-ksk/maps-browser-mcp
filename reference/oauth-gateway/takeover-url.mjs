export function normalizedTopLevelTakeoverUrl(requestUrl, path) {
  if (!/^\/takeover\/[A-Za-z0-9-]{8,100}$/.test(path)) return requestUrl;
  const url = new URL(requestUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}
