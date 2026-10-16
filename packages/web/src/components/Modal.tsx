/**
 * 弹窗容器：React portal 到 body。
 * 为什么必须 portal：会话页 header 有 backdrop-filter（毛玻璃），CSS 规范下
 * 带 backdrop-filter 的祖先会成为 fixed 后代的 containing block——不 portal
 * 的话 modal 会被钉死在 header 的 50px 高度里（2026-10-17 UI bug 实测踩坑）。
 */
import { createPortal } from "react-dom";

export function Modal({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return createPortal(
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
