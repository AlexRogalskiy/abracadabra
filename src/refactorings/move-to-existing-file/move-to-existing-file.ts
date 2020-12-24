import { Editor, ErrorReason, Path } from "../../editor/editor";
import { Selection } from "../../editor/selection";
import * as t from "../../ast";

export { moveToExistingFile, createVisitor };

async function moveToExistingFile(editor: Editor) {
  const { code, selection } = editor;

  // TODO: what if there's no other file?
  // TODO: Fine-tune when there are many (matchOnDescription + placeholder)
  const files = await editor.workspaceFiles();
  const selectedFile = await editor.askUserChoice(
    files.map((path) => ({ label: path.value, value: path }))
  );
  if (!selectedFile) return;

  const relativePath = selectedFile.value;
  const { updatedCode, movedNode } = updateCode(
    t.parse(code),
    selection,
    relativePath
  );

  if (!updatedCode.hasCodeChanged) {
    editor.showError(ErrorReason.DidNotFindCodeToMove);
    return;
  }

  const otherFileCode = await editor.codeOf(relativePath);
  const otherFileUpdatedCode = updateOtherFileCode(
    t.parse(otherFileCode),
    movedNode
  );

  await editor.writeIn(relativePath, otherFileUpdatedCode.code);
  await editor.write(updatedCode.code);
}

function updateCode(
  ast: t.AST,
  selection: Selection,
  relativePath: Path
): { updatedCode: t.Transformed; movedNode: t.Node } {
  let movedNode: t.Node = t.emptyStatement();

  const updatedCode = t.transformAST(
    ast,
    createVisitor(selection, (path, importIdentifier, programPath) => {
      const importStatement = t.importDeclaration(
        [t.importSpecifier(importIdentifier, importIdentifier)],
        t.stringLiteral(relativePath.withoutExtension)
      );

      movedNode = path.node;
      programPath.node.body.unshift(importStatement);
      path.remove();
    })
  );

  return { updatedCode, movedNode };
}

function updateOtherFileCode(ast: t.AST, movedNode: t.Node): t.Transformed {
  return t.transformAST(ast, {
    Program(path) {
      const exportedStatement = t.toStatement(
        t.exportNamedDeclaration(movedNode)
      );
      path.node.body.push(exportedStatement);
    }
  });
}

function createVisitor(
  selection: Selection,
  onMatch: (
    path: t.NodePath<t.FunctionDeclaration>,
    importIdentifier: t.Identifier,
    program: t.NodePath<t.Program>
  ) => void
): t.Visitor {
  return {
    FunctionDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      if (!path.node.id) return;
      if (!selection.isInsidePath(path)) return;

      onMatch(path, path.node.id, path.parentPath);
    }
  };
}
