/* -------------------------------- */
/* types */
/* -------------------------------- */

export interface IFormatConfig {
    sortUsingsEnabled: boolean;
    sortUsingsOrder: string;
    sortUsingsSplitGroups: boolean;
}

interface ParsedUsing {
    kind: 'normal' | 'static' | 'alias';
    namespace: string;
    alias?: string;
    raw: string;
}

/* -------------------------------- */
/* helpers */
/* -------------------------------- */

const parseUsing = (line: string): ParsedUsing | null => {
    const trimmed = line.trim();

    // using Alias = Namespace;
    const aliasMatch = trimmed.match(/^using\s+(\w+)\s*=\s*(.+);$/);
    if (aliasMatch) {
        return {
            kind: 'alias',
            alias: aliasMatch[1],
            namespace: aliasMatch[2].trim(),
            raw: line
        };
    }

    // using static Namespace;
    const staticMatch = trimmed.match(/^using\s+static\s+((?:global::)?[\w.:]+);$/);
    if (staticMatch) {
        const ns = staticMatch[1].replace(/^global::/, '').replace(/::/g, '.');
        return { kind: 'static', namespace: ns, raw: line };
    }

    // using Namespace;
    const normalMatch = trimmed.match(/^using\s+((?:global::)?[\w.:]+);$/);
    if (normalMatch) {
        const ns = normalMatch[1].replace(/^global::/, '').replace(/::/g, '.');
        return { kind: 'normal', namespace: ns, raw: line };
    }

    return null;
};

const getFirstSegment = (ns: string): string => ns.split('.')[0];

const stripInlineComments = (line: string): string => {
    let result = '';
    let inString = false;
    let stringChar = '';
    let i = 0;

    while (i < line.length) {
        if (!inString && (line[i] === '"' || line[i] === "'")) {
            inString = true;
            stringChar = line[i];
            result += line[i++];
        } else if (inString && line[i] === stringChar && line[i - 1] !== '\\') {
            inString = false;
            result += line[i++];
        } else if (!inString && line.startsWith('//', i)) {
            break;
        } else if (!inString && line.startsWith('/*', i)) {
            const end = line.indexOf('*/', i + 2);
            if (end === -1) break;
            i = end + 2;
        } else {
            result += line[i++];
        }
    }

    return result;
};

const getNamespaceOrder = (ns: string, ordered: string[]): number => {
    for (let i = 0; i < ordered.length; i++) {
        const prefix = ordered[i];
        if (ns.startsWith(prefix)) return ordered.length - i;
    }
    return 0;
};

/* -------------------------------- */
/* namespace transforms */
/* -------------------------------- */

const convertBlockNamespaceToFileScoped = (content: string): string => {
    const regex = /^(\s*)namespace\s+([\w.]+)\s*\{\s*\n([\s\S]*)\n\s*\}\s*$/m;
    const match = content.match(regex);
    if (!match) return content;

    const [, indent, name, body] = match;

    const lines = body.split('\n');
    let minIndent = Infinity;

    for (const line of lines) {
        if (line.trim().length === 0) continue;
        const indentMatch = line.match(/^(\s*)/);
        const count = indentMatch ? indentMatch[1].length : 0;
        minIndent = Math.min(minIndent, count);
    }

    const dedented = lines
        .map(l => (l.trim() ? l.slice(minIndent) : ''))
        .join('\n')
        .trim();

    return `${indent}namespace ${name};\n\n${dedented}\n`;
};

const moveNamespaceToTop = (content: string): string => {
    const nsRegex = /^(\s*namespace\s+[\w.]+\s*;)/m;
    const match = content.match(nsRegex);
    if (!match) return content;

    const nsLine = match[1].trim();
    const lines = content.split('\n');

    let firstCode = -1;
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('#')) {
            firstCode = i;
            break;
        }
    }

    if (firstCode !== -1 && lines[firstCode].trim() === nsLine) {
        return content;
    }

    content = content.replace(nsRegex, '');
    const out = content.split('\n');

    let insert = 0;
    for (let i = 0; i < out.length; i++) {
        const t = out[i].trim();
        if (t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('#')) {
            insert = i;
            break;
        }
    }

    out.splice(insert, 0, nsLine, '');
    return out.join('\n');
};

/* -------------------------------- */
/* main processor */
/* -------------------------------- */

export const process = (content: string, options: IFormatConfig): string => {
    try {
        content = convertBlockNamespaceToFileScoped(content);
        content = moveNamespaceToTop(content);

        const lines = content.split('\n');

        let usingStart = -1;
        let usingEnd = -1;
        let inBlockComment = false;

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const stripped = stripInlineComments(raw);
            const trimmed = stripped.trim();

            if (!inBlockComment && raw.includes('/*') && !raw.includes('*/')) {
                inBlockComment = true;
                continue;
            }
            if (inBlockComment) {
                if (raw.includes('*/')) inBlockComment = false;
                continue;
            }

            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

            if (usingStart === -1 && trimmed.startsWith('[')) continue;

            if (trimmed.startsWith('using ')) {
                if (usingStart === -1) usingStart = i;
                usingEnd = i;
                continue;
            }

            if (
                trimmed.startsWith('namespace ') ||
                /^(public|internal|private|protected|sealed|abstract|static|partial)\s+(class|struct|interface|record|enum)\b/.test(trimmed) ||
                /^(class|struct|interface|record|enum)\b/.test(trimmed) ||
                trimmed.startsWith('[')
            ) {
                break;
            }

            if (usingStart !== -1) break;
        }

        if (usingStart === -1) return content;

        const before = lines.slice(0, usingStart);
        const usingLines = lines.slice(usingStart, usingEnd + 1);
        const after = lines.slice(usingEnd + 1);

        const parsed = usingLines
            .map(parseUsing)
            .filter((u): u is ParsedUsing => u !== null);

        const normal = parsed.filter(u => u.kind === 'normal' || u.kind === 'static');
        const alias = parsed.filter(u => u.kind === 'alias');

        const uniqueNormal = normal.filter(
            (u, i, arr) =>
                arr.findIndex(x => x.namespace === u.namespace && x.kind === u.kind) === i
        );

        const uniqueAlias = alias.filter(
            (u, i, arr) =>
                arr.findIndex(x => x.alias === u.alias && x.namespace === u.namespace) === i
        );

        const hasSystemSub = uniqueNormal.some(
            u => u.kind === 'normal' && u.namespace.startsWith('System.')
        );

        const filtered = hasSystemSub
            ? uniqueNormal.filter(u => !(u.kind === 'normal' && u.namespace === 'System'))
            : uniqueNormal;

        const sortOrder = options.sortUsingsOrder || 'System';
        const priority = sortOrder.split(' ');

        filtered.sort((a, b) => {
            const pa = getNamespaceOrder(a.namespace, priority);
            const pb = getNamespaceOrder(b.namespace, priority);
            if (pa !== pb) return pb - pa;

            const al = a.namespace.toLowerCase();
            const bl = b.namespace.toLowerCase();
            if (al !== bl) return al < bl ? -1 : 1;

            if (a.namespace !== b.namespace) return a.namespace < b.namespace ? -1 : 1;

            if (a.kind !== b.kind) return a.kind === 'normal' ? -1 : 1;

            return 0;
        });

        uniqueAlias.sort((a, b) => (a.alias || '').localeCompare(b.alias || ''));

        let result: string[] = [];

        if (options.sortUsingsSplitGroups && filtered.length > 0) {
            let last = '';
            for (const u of filtered) {
                const seg = getFirstSegment(u.namespace);
                if (last && seg !== last) result.push('');
                result.push(u.raw);
                last = seg;
            }
        } else {
            result = filtered.map(u => u.raw);
        }

        if (uniqueAlias.length > 0) {
            if (result.length > 0) result.push('');
            result.push(...uniqueAlias.map(u => u.raw));
        }

        const out: string[] = [];
        out.push(...before);
        if (result.length > 0) {
            out.push(...result);
            out.push('');
        }
        out.push(...after);

        const headerEnd = before.length + result.length + 2;
        for (let i = 0; i < Math.min(headerEnd, out.length - 2); i++) {
            while (
                out[i] === '' &&
                out[i + 1] === '' &&
                out[i + 2] === ''
            ) {
                out.splice(i + 1, 1);
            }
        }

        return out.join('\n');
    } catch (ex: any) {
        throw `internal error (please, report to extension owner): ${ex.message}`;
    }
};
