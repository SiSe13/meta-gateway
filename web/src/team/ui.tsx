import { Children, cloneElement, isValidElement, useId, type ReactNode } from "react";
import { Description, Fieldset, Label, Modal, TextField, useOverlayState } from "@heroui/react";

export function TeamModal({
  title,
  children,
  busy,
  onClose,
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
}) {
  // 团队弹窗始终由父级挂载状态控制，关闭请求统一回传给业务页面。
  const state = useOverlayState({
    isOpen: true,
    onOpenChange: (isOpen) => {
      if (!isOpen && !busy) onClose();
    },
  });

  return (
    <Modal.Root state={state}>
      <Modal.Trigger className="team-modal-trigger" aria-hidden="true" tabIndex={-1} />
      <Modal.Backdrop className="team-modal-backdrop" isDismissable={false}>
        <Modal.Container className="team-modal-container" size="lg" scroll="inside">
          <Modal.Dialog className="team-modal">
            <Modal.Header className="team-modal-header">
              <Modal.Heading>{title}</Modal.Heading>
              <Modal.CloseTrigger
                className="team-modal-close"
                aria-label="Close / 关闭"
                isDisabled={busy}
              >
                ×
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="team-modal-body">
              <Fieldset.Root className="team-modal-content" disabled={busy}>
                {children}
              </Fieldset.Root>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}

export function TeamField({
  label,
  hint,
  children,
}: {
  label: string;
  /** A short explanation under the control, for fields whose meaning is not
   *  obvious from the label (quota units, "0 means unlimited"). */
  hint?: string;
  children: ReactNode;
}) {
  const fieldID = useId();
  const labelID = `${fieldID}-label`;
  const hintID = `${fieldID}-hint`;

  // React Aria 标签对原生下拉框也通过 id 建立显式关联，并为提示补上描述关系。
  const controls = Children.map(children, (child) => {
    if (
      !isValidElement<{
        id?: string;
        "aria-labelledby"?: string;
        "aria-describedby"?: string;
        type?: string;
      }>(child) ||
      typeof child.type !== "string" ||
      !["input", "select", "textarea"].includes(child.type) ||
      (child.type === "input" && child.props.type === "hidden")
    ) {
      return child;
    }

    return cloneElement(child, {
      id: fieldID,
      "aria-labelledby": labelID,
      ...(hint ? { "aria-describedby": hintID } : {}),
    });
  });

  return (
    <TextField className="team-field" fullWidth>
      <Label className="team-field-label" id={labelID} htmlFor={fieldID}>
        {label}
      </Label>
      {controls}
      {hint ? (
        <Description className="team-hint" id={hintID}>
          {hint}
        </Description>
      ) : null}
    </TextField>
  );
}
