import { useMemo, type ReactNode } from 'react';
import { ChevronRight, Folder } from 'lucide-react';

type Node<T> = { name: string; path: string; children: Map<string, Node<T>>; item?: T };

// Git paths are split only on '/', so names containing backslashes stay intact.
export function FileTree<T extends { path: string }>({
  files,
  renderFile,
  label,
}: {
  files: T[];
  renderFile: (file: T) => ReactNode;
  label: string;
}) {
  const root = useMemo(() => {
    const root: Node<T> = { name: '', path: '', children: new Map() };
    for (const file of files) {
      let node = root;
      for (const name of file.path.split('/')) {
        if (!node.children.has(name))
          node.children.set(name, {
            name,
            path: node.path ? `${node.path}/${name}` : name,
            children: new Map(),
          });
        node = node.children.get(name)!;
      }
      node.item = file;
    }
    return root;
  }, [files]);
  const children = (node: Node<T>): ReactNode =>
    [...node.children.values()]
      .sort((a, b) => Number(!!a.item) - Number(!!b.item) || a.name.localeCompare(b.name))
      .map((child) => (
        <li key={child.path}>
          {child.item && renderFile(child.item)}
          {child.children.size > 0 && (
            <details className="file-tree-directory" open>
              <summary title={child.path}>
                <ChevronRight size={12} />
                <Folder size={14} />
                <span>{child.name}</span>
              </summary>
              <ul>{children(child)}</ul>
            </details>
          )}
        </li>
      ));
  return (
    <ul className="file-tree" aria-label={label}>
      {children(root)}
    </ul>
  );
}
