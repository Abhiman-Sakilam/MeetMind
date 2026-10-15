import ReactMarkdown from 'react-markdown';

interface Props {
  content: string;
}

export function MarkdownMessage({ content }: Props) {
  return (
    <div className="prose-jarvis">
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h3 className="text-sm font-bold text-white mt-2 mb-1">{children}</h3>,
          h2: ({ children }) => <h4 className="text-sm font-bold text-white mt-2 mb-1">{children}</h4>,
          h3: ({ children }) => <h4 className="text-[13px] font-semibold text-surface-100 mt-1.5 mb-0.5">{children}</h4>,
          p: ({ children }) => <p className="text-sm text-surface-200 mb-1.5 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
          em: ({ children }) => <em className="text-surface-300 italic">{children}</em>,
          ul: ({ children }) => <ul className="space-y-0.5 mb-1.5 ml-1">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-0.5 mb-1.5 ml-1 list-decimal list-inside">{children}</ol>,
          li: ({ children }) => (
            <li className="text-sm text-surface-200 leading-relaxed flex gap-1.5">
              <span className="text-accent shrink-0 mt-0.5">•</span>
              <span>{children}</span>
            </li>
          ),
          code: ({ children }) => (
            <code className="px-1 py-0.5 bg-surface-700 rounded text-xs text-accent-light font-mono">
              {children}
            </code>
          ),
          hr: () => <hr className="border-surface-700 my-2" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
