// This program will detect if GitHub Copilot is installed and active in the user's VSCode environment, 
// allowing the extension to adjust its behavior accordingly

import * as vscode from 'vscode';

export function isCopilotActive() { // Function to check if GitHub Copilot is active in the VSCode environment
    const copilot = vscode.extensions.getExtension('GitHub.copilot'); // Attempt to retrieve the GitHub Copilot extension by its identifier
    const copilotChat = vscode.extensions.getExtension('GitHub.copilot-chat'); // Attempt to retrieve the GitHub Copilot Chat extension by its identifier

    return {
        installed: !!copilot, // Check if the Copilot extension is installed by verifying if the extension object exists
        active: copilot?.isActive ?? false, // Check if the Copilot extension is active by verifying the isActive property, defaulting to false if the extension is not installed
        chatInstalled: !!copilotChat, // Check if the Copilot Chat extension is installed by verifying if the extension object exists
        chatActive: copilotChat?.isActive ?? false // Check if the Copilot Chat extension is active by verifying the isActive property, defaulting to false if the extension is not installed
    };
}