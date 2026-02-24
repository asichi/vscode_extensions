import * as vscode from 'vscode';
import { process, IFormatConfig } from './formatter';

export function activate(context: vscode.ExtensionContext) {
    console.log('C# Custom Formatter is now active');

    // Register as a manual command (not default formatter)
    const command = vscode.commands.registerCommand('csharpCustomFormatter.format', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'csharp') {
            vscode.window.showErrorMessage('This command only works on C# files');
            return;
        }

        const config = vscode.workspace.getConfiguration('csharpCustomFormatter');

        const options: IFormatConfig = {
            sortUsingsEnabled: config.get('sortUsingsEnabled', true),
            sortUsingsOrder: config.get('sortUsingsOrder', 'System'),
            sortUsingsSplitGroups: config.get('sortUsingsSplitGroups', true)
        };

        try {
            const document = editor.document;
            const content = document.getText();
            const formatted = process(content, options);

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(content.length)
            );

            editor.edit(editBuilder => {
                editBuilder.replace(fullRange, formatted);
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Format error: ${error}`);
        }
    });

    context.subscriptions.push(command);
}

export function deactivate() { }