export interface IFormatConfig {
    sortUsingsEnabled: boolean;
    sortUsingsOrder: string;
    sortUsingsSplitGroups: boolean;
}

export interface IResult {
    source?: string;
    error?: string;
}

type Func<T, S> = (...args: S[]) => T;

/* -------------------------------- */
/* helpers */
/* -------------------------------- */

const moveNamespaceToTop = (content: string): string => {
    const nsRegex = /^\s*(namespace\s+[^\s{;]+[^{;]*;)/m;
    const match = content.match(nsRegex);
    if (!match) return content;

    let nsLine = match[1];

    // normalize namespace line
    nsLine = nsLine.trim();

    // remove it from original position
    content = content.replace(nsRegex, "").trimStart();

    // ensure exactly ONE blank line after namespace
    return nsLine + "\n\n" + content.replace(/^\s+/, "");
};

const convertBlockNamespaceToFileScoped = (content: string): string => {
    const regex = /^\s*namespace\s+([^\s{]+)\s*\{\s*([\s\S]*)\s*\}\s*$/m;
    const match = content.match(regex);
    if (!match) return content;

    const [, name, body] = match;

    // Dedent body by removing one indentation level (4 spaces) from each line
    const dedented = body
        .split('\n')
        .map(line => line.replace(/^    /, ''))  // Remove 4 spaces from start of each line
        .join('\n')
        .trim();

    return `namespace ${name};\n\n${dedented}\n`;
};

const cleanRedundantSystemUsing = (lines: string[]): string[] => {
    const hasSystemSub = lines.some(l => /^using\s+System\./.test(l));
    if (!hasSystemSub) return lines;
    return lines.filter(l => l.trim() !== "using System;");
};

const replaceCode = (
    source: string,
    condition: RegExp,
    cb: Func<string, string>
): string => {
    const flags = condition.flags.replace(/[gm]/g, '');
    const regexp = new RegExp(condition.source, `gm${flags}`);

    return source.replace(regexp, (s: string, ...args: string[]) => {
        if (
            s[0] === '"' ||
            s[0] === "'" ||
            (s[0] === "/" && (s[1] === "/" || s[1] === "*"))
        ) {
            return s;
        }
        return cb(s, ...args.slice(1));
    });
};

const getNamespaceOrder = (ns: string, orderedNames: string[]): number => {
    for (let i = 0; i < orderedNames.length; i++) {
        const item = orderedNames[i];
        const nsTest = item.length < ns.length ? ns.substr(0, item.length) : ns;
        if (item === nsTest) return orderedNames.length - i;
    }
    return 0;
};

/* -------------------------------- */
/* main processor */
/* -------------------------------- */

export const process = (content: string, options: IFormatConfig): string => {
    try {

        /* ---------- modern namespace rules ---------- */

        content = convertBlockNamespaceToFileScoped(content);
        content = moveNamespaceToTop(content);

        const trimSemiColon = /^\s+|;\s*$/;

        content = replaceCode(
            content,
            /^(\s*using\s+[\w\s.=]+;.*(?:\n(?:\s*using\s+[\w\s.=]+;.*|\s*))*)/gm,
            rawBlock => {

                // Remove ALL blank lines from input first
                rawBlock = rawBlock.replace(/^\s*$/gm, '').replace(/\n\n+/g, '\n');

                let items = rawBlock
                    .split(/[\r\n]+/)
                    .filter(l => l && l.trim().length > 0);

                // separate alias definitions
                const defs = items.filter(l => l.includes("="));
                items = items.filter(l => !l.includes("="));

                // remove duplicates
                items = items.filter((v, i, a) => a.indexOf(v) === i);

                // remove redundant System;
                items = cleanRedundantSystemUsing(items);

                // force System.* priority
                if (!options.sortUsingsOrder)
                    options.sortUsingsOrder = "System";

                items.sort((a: string, b: string) => {
                    let res = 0;

                    a = a.replace(trimSemiColon, '');
                    b = b.replace(trimSemiColon, '');

                    const ns = options.sortUsingsOrder.split(' ');

                    res -= getNamespaceOrder(a.substr(6), ns);
                    res += getNamespaceOrder(b.substr(6), ns);
                    if (res !== 0) return res;

                    for (let i = 0; i < a.length; i++) {
                        const lhs = a[i].toLowerCase();
                        const rhs = b[i] ? b[i].toLowerCase() : b[i];
                        if (lhs !== rhs) {
                            res = lhs < rhs ? -1 : 1;
                            break;
                        }
                        if (lhs !== a[i]) res++;
                        if (rhs !== b[i]) res--;
                        if (res !== 0) break;
                    }

                    return res === 0 && b.length > a.length ? -1 : res;
                });

                if (options.sortUsingsSplitGroups) {
                    const grouped: string[] = [];
                    let lastNS = '';

                    for (let i = 0; i < items.length; i++) {
                        const currentNS = items[i].replace(/\s*using\s+(\w+).*/, '$1');

                        if (i > 0 && currentNS !== lastNS) {
                            grouped.push('');  // blank line before new group
                        }

                        grouped.push(items[i]);
                        lastNS = currentNS;
                    }

                    items = grouped;
                }

                let result = '';
                if (items.length > 0) result += items.join('\n') + '\n\n';
                if (defs.length > 0) result += defs.join('\n') + '\n\n';

                return result;
            }
        );

        // FIXED: Handle both namespace and top-level files
        // Ensure blank line after namespace (if present)
        content = content.replace(/(namespace\s+[^\s{;]+;)\n+(using\s)/, '$1\n\n$2');

        // Ensure blank line after using blocks (for top-level statements)
        content = content.replace(/(using\s+[^;]+;\n)\n+((?!using\s|namespace\s|^\s*$)\S)/, '$1\n$2');

        return content;
    }
    catch (ex: any) {
        throw `internal error (please, report to extension owner): ${ex.message}`;
    }
};