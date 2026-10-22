import './styles/game.css';
import { initializeApplication } from './bootstrap.js';
import { sealPolicies } from './engine/policies.js';
import { installDiagnostics } from './runtime/diagnostics.js';
initializeApplication();
sealPolicies();
installDiagnostics();
