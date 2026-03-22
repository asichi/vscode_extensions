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

    const aliasMatch = trimmed.match(/^using\s+(\w+)\s*=\s*(.+);$/);
    if (aliasMatch) {
        return {
            kind: 'alias',
            alias: aliasMatch[1],
            namespace: aliasMatch[2].trim(),
            raw: line
        };
    }

    const staticMatch = trimmed.match(/^using\s+static\s+((?:global::)?[\w.:]+);$/);
    if (staticMatch) {
        const ns = staticMatch[1].replace(/^global::/, '').replace(/::/g, '.');
        return { kind: 'static', namespace: ns, raw: line };
    }

    const normalMatch = trimmed.match(/^using\s+((?:global::)?[\w.:]+);$/);
    if (normalMatch) {
        const ns = normalMatch[1].replace(/^global::/, '').replace(/::/g, '.');
        return { kind: 'normal', namespace: ns, raw: line };
    }

    return null;
};

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

const getFirstSegment = (ns: string): string => ns.split('.')[0];

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
/* using extraction */
/* -------------------------------- */

const extractUsings = (lines: string[]) => {
    let start = -1;
    let end = -1;
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = stripInlineComments(raw).trim();

        if (!inBlockComment && trimmed.startsWith('/*') && !trimmed.includes('*/')) {
            inBlockComment = true;
            continue;
        }
        if (inBlockComment) {
            if (trimmed.includes('*/')) inBlockComment = false;
            continue;
        }

        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#'))
            continue;

        if (trimmed.startsWith('['))
            continue;

        if (trimmed.startsWith('namespace ') && trimmed.endsWith(';'))
            continue;

        if (trimmed.startsWith('namespace '))
            break;

        if (/^(public|internal|private|protected|sealed|abstract|static|partial)?\s*(class|struct|interface|record|enum)\b/.test(trimmed))
            break;

        if (trimmed.startsWith('using ')) {
            if (start === -1) start = i;
            end = i;
            continue;
        }

        // Blank line *between* using groups → include
        if (start !== -1 && trimmed === '') {
            // Look ahead: if next non-blank is a using, include this blank
            let j = i + 1;
            while (j < lines.length && lines[j].trim() === '') j++;

            if (j < lines.length && lines[j].trim().startsWith('using ')) {
                end = i;
                continue;
            }

            // Otherwise: blank after last using → stop
            break;
        }

        if (start !== -1)
            break;

    }

    return { start, end };
};

/* -------------------------------- */
/* using sorting */
/* -------------------------------- */

const sortUsings = (parsed: ParsedUsing[], order: string, splitGroups: boolean): string[] => {
    const normal = parsed.filter(u => u.kind === 'normal' || u.kind === 'static');
    const alias = parsed.filter(u => u.kind === 'alias');

    const uniqNormal = normal.filter(
        (u, i, arr) => arr.findIndex(x => x.namespace === u.namespace && x.kind === u.kind) === i
    );
    const uniqAlias = alias.filter(
        (u, i, arr) => arr.findIndex(x => x.alias === u.alias && x.namespace === u.namespace) === i
    );

    const hasSystemSub = uniqNormal.some(u => u.namespace.startsWith('System.'));
    const filtered = hasSystemSub
        ? uniqNormal.filter(u => u.namespace !== 'System')
        : uniqNormal;

    const priority = order.split(' ');
    const getOrder = (ns: string) => {
        for (let i = 0; i < priority.length; i++)
            if (ns.startsWith(priority[i]))
                return priority.length - i;
        return 0;
    };

    filtered.sort((a, b) => {
        const pa = getOrder(a.namespace);
        const pb = getOrder(b.namespace);
        if (pa !== pb) return pb - pa;

        const al = a.namespace.toLowerCase();
        const bl = b.namespace.toLowerCase();
        if (al !== bl) return al < bl ? -1 : 1;

        if (a.kind !== b.kind) return a.kind === 'normal' ? -1 : 1;

        return 0;
    });

    uniqAlias.sort((a, b) => (a.alias || '').localeCompare(b.alias || ''));

    let result: string[] = [];
    if (splitGroups) {
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

    if (uniqAlias.length > 0) {
        if (result.length > 0) result.push('');
        result.push(...uniqAlias.map(u => u.raw));
    }

    return result;
};

/* -------------------------------- */
/* main processor */
/* -------------------------------- */

export const process = (content: string, options: IFormatConfig): string => {
    content = convertBlockNamespaceToFileScoped(content);
    content = moveNamespaceToTop(content);

    const lines = content.split('\n');

    const { start, end } = extractUsings(lines);
    if (start === -1) return content;

    const before = lines.slice(0, start);
    const usingLines = lines.slice(start, end + 1);
    const after = lines.slice(end + 1);

    const parsed = usingLines
        .map(parseUsing)
        .filter((u): u is ParsedUsing => u !== null);

    const sorted = sortUsings(parsed, options.sortUsingsOrder, options.sortUsingsSplitGroups);

    const out: string[] = [];
    out.push(...before);
    out.push(...sorted);

    // Only add a blank line if the next section does NOT already start with one
    if (out.length > 0 && out[out.length - 1] !== '' && after[0]?.trim() !== '') {
        out.push('');
    }

    out.push(...after);

    // Collapse duplicate blank lines
    for (let i = 0; i < out.length - 1; i++) {
        if (out[i] === '' && out[i + 1] === '') {
            out.splice(i + 1, 1);
            i--;
        }
    }

    return out.join('\n');
};
