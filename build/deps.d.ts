/**
 * Install script dependencies without changing the project manifest
 * @param dependencies object of dependencies
 * @param prefix path to the directory where dependencies should be installed
 * @param registry custom npm registry URL when installing dependencies
 * @param installerType package manager: pnpm (default) or npm
 */
export declare function installDeps(dependencies: Record<string, string>, prefix?: string, registry?: string, installerType?: string): Promise<void>;
export declare function parseDeps(content: string): Record<string, string>;
