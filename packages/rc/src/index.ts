import { homedir } from "node:os";
import { cwd, env } from "node:process";

import { isAccessibleSync, readFileSync } from "@visulima/fs";
import { parseJson, stripJsonComments } from "@visulima/fs/utils";
// eslint-disable-next-line import/no-extraneous-dependencies
import { dirname, join } from "@visulima/path";
import { parse } from "ini";
import { merge } from "ts-deepmerge";

import isJson from "./utils/is-json";

// eslint-disable-next-line no-secrets/no-secrets
/**
 * Modified copy of the env function from https://github.com/dominictarr/rc/blob/a97f6adcc37ee1cad06ab7dc9b0bd842bbc5c664/lib/utils.js#L42
 *
 * @license https://github.com/dominictarr/rc/blob/master/LICENSE.APACHE2
 * @license https://github.com/dominictarr/rc/blob/master/LICENSE.BSD
 * @license https://github.com/dominictarr/rc/blob/master/LICENSE.MIT
 *
 * @param {string} prefix
 * @param {Record<string, string | undefined>} environment
 *
 * @returns {Record<string, any>}
 */
// eslint-disable-next-line sonarjs/cognitive-complexity,@typescript-eslint/no-explicit-any
const getEnvironment = (prefix: string, environment: Record<string, string | undefined> = env): Record<string, any> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnValue: Record<string, any> = {};
    const l = prefix.length;

    // eslint-disable-next-line no-loops/no-loops,no-restricted-syntax
    for (const k in environment) {
        if (k.toLowerCase().startsWith(prefix.toLowerCase())) {
            const keypath = k.slice(Math.max(0, l)).split("__");

            // Trim empty strings from keypath array
            let emptyStringIndex;

            // eslint-disable-next-line no-loops/no-loops,no-cond-assign
            while ((emptyStringIndex = keypath.indexOf("")) > -1) {
                keypath.splice(emptyStringIndex, 1);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let cursor: Record<string, any> = returnValue;

            keypath.forEach((subkey, index) => {
                // (check for subkey first so we ignore empty strings)
                // (check for cursor to avoid assignment to primitive objects)
                if (!subkey || typeof cursor !== "object") {
                    return;
                }

                // If this is the last key, just stuff the value in there
                // Assigns actual value from env variable to final key
                // (unless it's just an empty string- in that case use the last valid key)
                if (index === keypath.length - 1) {
                    // eslint-disable-next-line security/detect-object-injection
                    cursor[subkey] = environment[k];
                }

                // Build sub-object if nothing already exists at the keypath
                // eslint-disable-next-line security/detect-object-injection
                if (cursor[subkey] === undefined) {
                    // eslint-disable-next-line security/detect-object-injection
                    cursor[subkey] = {};
                }

                // Increment cursor used to track the object at the current depth
                // eslint-disable-next-line security/detect-object-injection
                cursor = cursor[subkey];
            });
        }
    }

    return returnValue;
};

/**
 * Will look in all the obvious places for configuration:
 *
 * - The defaults object you passed in
 * - `/etc/${appname}/config`
 * - `/etc/${appname}rc`
 * - `$HOME/.config/${appname}/config`
 * - `$HOME/.config/${appname}`
 * - `$HOME/.${appname}/config`
 * - `$HOME/.${appname}rc`
 * - a local `.${appname}/config` and `.${appname}rc` and all found looking in `../../../ ../../ ../ ./` etc.
 * - if you passed environment variable `${appname}_config` then from that file
 * - if you passed options.config variable, then from that file
 * - environment variables prefixed with `${appname}_`
 *   or use "\_\_" to indicate nested properties <br/> _(e.g. `appname_foo__bar__baz` => `foo.bar.baz`)_
 *
 * @param {string} name
 * @param {string} home
 * @param {string} internalCwd
 * @param {string | undefined} stopAt
 * @param {string | undefined} environmentConfig
 * @param {string | undefined} optionConfig
 * @returns {Array<string>}
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
const getConfigFiles = (name: string, home: string, internalCwd: string, stopAt?: string, environmentConfig?: string, optionConfig?: string): string[] => {
    const configFiles = new Set<string>();

    // eslint-disable-next-line no-loops/no-loops,no-restricted-syntax
    for (const file of [`/etc/${name}/config`, `/etc/${name}rc`]) {
        if (isAccessibleSync(file)) {
            configFiles.add(file);
        }
    }

    // eslint-disable-next-line no-loops/no-loops,no-restricted-syntax
    for (const file of [join(home, ".config", name, "config"), join(home, ".config", name), join(home, `.${name}`, "config"), join(home, `.${name}rc`)]) {
        if (isAccessibleSync(file)) {
            configFiles.add(file);
        }

        if (isAccessibleSync(`${file}.json`)) {
            configFiles.add(`${file}.json`);
        }
    }

    let start = internalCwd;
    let endOfLoop = false;

    const files = [join("." + name, "config.json"), join("." + name, "config"), join("." + name + "rc.json"), join("." + name + "rc")];

    const traversedFiles: string[] = [];

    // eslint-disable-next-line no-loops/no-loops
    do {
        // eslint-disable-next-line no-loops/no-loops,no-restricted-syntax
        for (const file of files) {
            const traverseFile = join(start, file);

            if (isAccessibleSync(traverseFile)) {
                traversedFiles.push(traverseFile);
            }
        }

        start = dirname(start);

        if (endOfLoop) {
            break;
        }

        endOfLoop = dirname(start) === start;
    } while (stopAt ? start === stopAt : true); // root

    // reverse the traversedFiles so its starts with root
    // eslint-disable-next-line no-loops/no-loops,no-restricted-syntax
    for (const file of traversedFiles.reverse()) {
        configFiles.add(file);
    }

    if (typeof environmentConfig === "string" && isAccessibleSync(environmentConfig)) {
        configFiles.add(environmentConfig);
    }

    if (optionConfig && isAccessibleSync(optionConfig)) {
        configFiles.add(optionConfig);
    }

    return [...configFiles];
};

// eslint-disable-next-line import/prefer-default-export
export const rc = (
    name: string,
    options: {
        config?: string;
        cwd?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaults?: Record<string, any>;
        home?: string;
        stopAt?: string;
    } = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { config: Record<string, any>; files: string[] } => {
    // eslint-disable-next-line no-param-reassign
    options = {
        cwd: cwd(),
        home: homedir(),
        ...options,
    };

    const { config: environmentConfig, ...environment } = getEnvironment(`${name}_`);

    const configFiles = getConfigFiles(name, options.home as string, options.cwd as string, options.stopAt, env[`${name}_config`], options.config);

    const configs: object[] = [];

    // eslint-disable-next-line no-loops/no-loops,no-restricted-syntax
    for (const file of configFiles) {
        const content = readFileSync(file);

        if (isJson(content)) {
            configs.push(parseJson(stripJsonComments(content)));
        } else {
            configs.push(parse(content));
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (environment) {
        configs.push(environment);
    }

    return { config: merge(options.defaults ?? {}, ...configs), files: configFiles };
};
