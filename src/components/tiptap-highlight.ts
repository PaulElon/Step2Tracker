export function getHighlightHtmlAttributes(attributes: Record<string, unknown>) {
  const bg = typeof attributes.color === "string" && attributes.color ? attributes.color : null;
  if (!bg) {
    return {};
  }

  return {
    "data-color": bg,
    style: `background-color: ${bg}; color: #1e293b`,
  };
}
