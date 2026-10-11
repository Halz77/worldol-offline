(() => {
    'use strict';

    const boot = document.createElement('script');
    boot.id = 'worldol-client-boot';
    boot.src = '/gd.js';
    document.body.appendChild(boot);
  })();