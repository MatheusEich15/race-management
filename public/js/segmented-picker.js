document.addEventListener('DOMContentLoaded', () => {
    // Function to convert a single select element into segmented control buttons
    function convertSelectToSegmented(select) {
        if (select.dataset.converted) return;
        select.dataset.converted = "true";
        select.style.display = 'none';

        // Store initial selected value on element dataset
        select.dataset.selectedValue = select.value || "3";

        // Create container wrapper
        const container = document.createElement('div');
        container.className = 'select-container-custom';
        container.dataset.forSelect = select.id;

        // Create label
        const label = document.createElement('div');
        label.className = 'select-label-custom';
        
        // Formulate a beautiful label text
        let labelText = select.id.replace('solo-', '').replace('local-', '').replace('lobby-', '');
        if (labelText === 'bots') labelText = 'Bots';
        if (labelText === 'diff') labelText = 'Difficulty';
        if (labelText === 'track') labelText = 'Track';
        // Capitalize first letter
        labelText = labelText.charAt(0).toUpperCase() + labelText.slice(1);
        label.textContent = labelText + ':';
        container.appendChild(label);

        // Group container for options
        const group = document.createElement('div');
        group.className = 'selector-group';
        container.appendChild(group);

        const isLapsSelect = select.id.endsWith('-laps');

        // Helper function to build options
        function buildOptions() {
            group.innerHTML = '';
            
            // Build preset option buttons
            Array.from(select.options).forEach(opt => {
                // Skip placeholder or dynamic custom options
                if (opt.value === "" && opt.disabled) return;

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'selector-option';
                btn.textContent = opt.textContent;
                btn.dataset.value = opt.value;

                if (select.value === opt.value) {
                    btn.classList.add('active');
                }

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    
                    // Update active class on buttons and clear custom input active state BEFORE dispatching change
                    group.querySelectorAll('.selector-option').forEach(b => {
                        b.classList.toggle('active', b.dataset.value === opt.value);
                    });
                    const inputEl = group.querySelector('.selector-option-input');
                    if (inputEl) {
                        inputEl.classList.remove('active');
                        inputEl.value = '';
                    }

                    // Explicitly update select options and dataset property
                    Array.from(select.options).forEach(o => {
                        o.selected = (o.value === opt.value);
                    });
                    select.value = opt.value;
                    select.dataset.selectedValue = opt.value;
                    select.dispatchEvent(new Event('change'));
                });

                group.appendChild(btn);
            });

            // Append inline custom input for laps selector
            if (isLapsSelect) {
                const customInput = document.createElement('input');
                customInput.type = 'number';
                customInput.className = 'selector-option-input';
                customInput.min = '1';
                customInput.max = '100';
                customInput.placeholder = 'Custom';

                // Check if current value is custom (not one of the preset options)
                const presetValues = Array.from(select.options).map(o => o.value);
                if (!presetValues.includes(select.value) && select.value) {
                    customInput.value = Math.min(100, Math.max(1, parseInt(select.value) || 3));
                    customInput.classList.add('active');
                    group.querySelectorAll('.selector-option').forEach(b => b.classList.remove('active'));
                }

                const applyCustomValue = () => {
                    let val = parseInt(customInput.value);
                    if (!isNaN(val)) {
                        if (val > 100) {
                            val = 100;
                            customInput.value = '100';
                        } else if (val < 1 && customInput.value !== '') {
                            val = 1;
                            customInput.value = '1';
                        }
                        group.querySelectorAll('.selector-option').forEach(b => b.classList.remove('active'));
                        customInput.classList.add('active');

                        let opt = Array.from(select.options).find(o => o.value === String(val));
                        if (!opt) {
                            opt = new Option(String(val), String(val));
                            select.add(opt);
                        }
                        Array.from(select.options).forEach(o => {
                            o.selected = (o.value === String(val));
                        });
                        select.value = String(val);
                        select.dataset.selectedValue = String(val);
                        select.dispatchEvent(new Event('change'));
                    } else if (customInput.value === '') {
                        customInput.classList.remove('active');
                    }
                };

                customInput.addEventListener('focus', () => {
                    if (customInput.value) applyCustomValue();
                });
                customInput.addEventListener('input', applyCustomValue);
                customInput.addEventListener('blur', () => {
                    if (!customInput.value || isNaN(parseInt(customInput.value))) {
                        customInput.classList.remove('active');
                        // Re-activate default option (3) if blank
                        const defaultBtn = Array.from(group.querySelectorAll('.selector-option')).find(b => b.dataset.value === '3') || group.querySelector('.selector-option');
                        if (defaultBtn) {
                            defaultBtn.click();
                        }
                    }
                });

                group.appendChild(customInput);
            }
        }

        buildOptions();

        // Save reference to container on select element
        select._segmentedContainer = container;

        // Insert container in place of parent row or before select
        const parentRow = select.closest('.setup-row');
        if (parentRow) {
            parentRow.parentNode.insertBefore(container, parentRow);
            parentRow.style.display = 'none';
        } else {
            select.parentNode.insertBefore(container, select);
        }
    }

    // Convert all selects present on the page
    document.querySelectorAll('select').forEach(select => {
        convertSelectToSegmented(select);
    });

    // Global robust value extractor for any segmented control
    window.getSegmentedValue = function(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return null;

        if (select.dataset.selectedValue) {
            const val = parseInt(select.dataset.selectedValue);
            if (!isNaN(val) && val > 0) return val;
        }

        let val = parseInt(select.value);
        if (!isNaN(val) && val > 0) return val;

        return null;
    };

    // Watch for new selects
    const bodyObserver = new MutationObserver((mutations) => {
        mutations.forEach(mut => {
            mut.addedNodes.forEach(node => {
                if (node.tagName === 'SELECT') {
                    convertSelectToSegmented(node);
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('select').forEach(s => convertSelectToSegmented(s));
                }
            });
        });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
});
