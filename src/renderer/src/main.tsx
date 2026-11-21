import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';
import { App } from './App';
import { exposeFaults } from './lib/i18n-faults';
import { currentLanguage } from '../../shared/i18n';
import { useApp } from './lib/store';
import { useLanguage } from './lib/use-language';

// The picture run asks each screen for clipped text and text that skipped tr() (plan B7).
exposeFaults(currentLanguage);

/** B5: the screens run in the language main runs in. A switch re-renders the app in the new language; it is not
 *  remounted, so the page on show (Settings, where the switch is made) and its scroll stay where they are. */
function LanguageRoot() {
  useLanguage(useApp((s) => s.snap?.language));
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageRoot />
  </React.StrictMode>,
);
