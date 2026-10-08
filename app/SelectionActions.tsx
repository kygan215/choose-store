type SelectionActionsProps = {
  scope: string;
  onSelectAll: () => void;
  onClear: () => void;
  allLabel?: string;
  clearLabel?: string;
  disabled?: boolean;
};

export default function SelectionActions({scope,onSelectAll,onClear,allLabel="全选",clearLabel="清空",disabled=false}:SelectionActionsProps) {
  return <span className="selection-shortcuts" role="group" aria-label={scope}>
    <button type="button" onClick={onSelectAll} disabled={disabled}>{allLabel}</button>
    <button type="button" onClick={onClear} disabled={disabled}>{clearLabel}</button>
  </span>;
}
