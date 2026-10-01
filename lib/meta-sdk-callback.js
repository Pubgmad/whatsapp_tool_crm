export function metaSdkCallback(work, onError) {
  return function handleMetaResponse(response) {
    Promise.resolve().then(() => work(response)).catch(onError);
  };
}
