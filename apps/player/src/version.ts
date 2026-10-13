/**
 * TVs keep the player open for months: when the server reports a new deploy, reload to pick up the new player.
 * Returns the function to call with the version of each manifest.
 */
export function watchVersion(reload: () => void): (version: string | undefined) => void {
  let first: string | undefined;
  return (version) => {
    if (!version) return;
    if (first === undefined) first = version;
    else if (version !== first) reload();
  };
}
