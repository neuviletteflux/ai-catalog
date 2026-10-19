/**
 * dsh-primary-session — Host half.
 *
 * The whole feature lives in the browser half (`./client`), discovered through
 * this package's `dsh.client` declaration. This empty apply only exists so the
 * package can be mounted as a normal Loader entry; it registers no prompt, tool,
 * session event, or host service.
 */
export function apply() {}
