# Zasady pracy agentów nad forkiem HAPI

## 1. Zakres i stan workspace

- Wykonuj wyłącznie zadanie zlecone przez użytkownika. Te zasady nie są poleceniem automatycznej przebudowy projektu, wdrożenia ani wydania wersji.
- Katalog roboczy forka: `/workspace/hapi`. Wszystkie zmiany implementacyjne wykonuj tutaj.
- `/workspace/hapi` jest niezależną kopią, a nie katalogiem bezpośrednio używanym przez produkcyjnego Huba na Serweuszu.
- Projekt referencyjny: `/workspace/hapi_original`, bezwzględnie tylko do odczytu.
- Upstream kodu HAPI wskazany przez użytkownika: [tiann/hapi](https://github.com/tiann/hapi). Odróżniaj repozytorium źródłowe od lokalnego katalogu referencyjnego `hapi_original`; nie zakładaj, że zawiera on pełne źródła upstream.
- `/workspace/prometheus/AGENTS.md` jest źródłem przejętych zasad wersjonowania. Nie modyfikuj Prometheusa w ramach pracy nad HAPI.
- Przy ustanawianiu tych zasad oba katalogi HAPI zawierały `Dockerfile`, `docker-compose.yml`, `.dockerignore` i `data/`. Nie zawierały `.git`, `README.md`, `package.json`, `src/constants.py` ani `docs/`. Dockerfile instaluje pakiet `@twsxtd/hapi`; nie jest to lokalne drzewo źródeł aplikacji.
- W ramach pierwszej implementacji forka zaimportowano pełne źródła z `matiziompl/hapi`, commit `f8e55fb930cde45dd4ef5cc5dd1fac0a047f38b8`. Dockerfile buduje lokalny Hub i frontend. Nie przywracaj instalacji gotowego pakietu npm w miejsce lokalnych zmian.
- Przed każdą pracą sprawdź aktualną strukturę i dostępność źródeł. Powyższy opis jest stanem zastanym, a nie zakazem późniejszego rozwoju projektu. Nie zakładaj istnienia repozytorium Git, plików wersji ani kodu, którego nie odnaleziono.

## 2. Bezwzględna ochrona `hapi_original`

- Wolno czytać kod, dokumentację i strukturę oraz analizować istniejącą historię Git, jeżeli jest dostępna. Każda operacja musi pozostawić stan projektu referencyjnego bez zmian.
- Nie twórz, nie modyfikuj, nie usuwaj i nie przenoś tam żadnych plików, także konfiguracji, danych, logów, cache i plików tymczasowych.
- Nie zmieniaj gałęzi, tagów, indeksu, konfiguracji ani historii Git. Nie wykonuj innych operacji Git zapisujących stan, w tym pobierania zmian do tego katalogu.
- Nie instaluj zależności, nie uruchamiaj buildów ani testów generujących pliki. Nie używaj tego katalogu jako miejsca implementacji ani katalogu roboczego narzędzi zapisujących dane.
- Sprawdzaj ścieżki docelowe, dowiązania i montowania, aby zapis z `hapi` nie trafiał do `hapi_original`. Odczyt źródła nie upoważnia do zmiany jego uprawnień ani montowań.

## 3. Architektura i środowisko uruchomieniowe

| Komponent | Środowisko i sposób uruchamiania |
| --- | --- |
| HAPI Hub | Serwer **Serweusz**, Debian 13 (Trixie), poza bieżącym kontenerem programistycznym; Docker i Docker Compose; własna konfiguracja uruchomieniowa i trwałe dane. |
| HAPI Runner | Kontener **`ai-workspace`**, Ubuntu 24.04, uruchamiany przez Podmana na Serweuszu; komunikuje się z Hubem działającym na hoście. |

- Nie zakładaj, że Hub i Runner działają w jednym kontenerze, mają wspólny system plików lub jednakowe ścieżki, uprawnienia i przestrzenie sieciowe.
- Każdą zmianę architektoniczną oceniaj z uwzględnieniem tego rozdzielenia. Plik dostępny dla Runnera nie musi być dostępny dla Huba i odwrotnie.
- Przed projektowaniem integracji prześledź rzeczywistą komunikację w kodzie i konfiguracji: inicjatora połączenia, transport, istniejące API, uwierzytelnianie i wymagane uprawnienia.
- Nie wymyślaj endpointów, protokołów, mechanizmów dostępu ani uprawnień. Jeśli brakuje źródeł lub konfiguracji potrzebnych do analizy, zgłoś ograniczenie.

### Przekazywanie i sprawdzanie iteracji

- Źródła projektu są dostępne na Serweuszu w `~/workspace/hapi`, a katalog docelowy Huba to `~/docker/hapi`. **Workspace jest źródłem kodu i historii Git. Agent tworzy tutaj lokalne commity, a użytkownik kopiuje wersjonowane źródła wraz z `.git` do katalogu Huba.** Ten przepływ zastępuje wcześniejsze utrzymywanie osobnych commitów na Serweuszu.
- Użytkownik podał dotychczasowy skrypt kopiujący **wszystko, także ukryty `.git`**, nazwany `docker-update.sh hapi` na Serweuszu. Skrypt używa `~/workspace/hapi` jako źródła i `~/docker/hapi` jako celu: zatrzymuje projekt Compose, usuwa cały katalog docelowy, kopiuje katalog źródłowy przez `cp -r`, a następnie buduje i uruchamia Compose. To opis faktycznie używanego skryptu, nie polecenie wykonania go przez agenta.
- Nie wymagaj osobnego przesyłania patcha, archiwum lub pakietu zmian. Komendy mają kopiować wskazane pliki bezpośrednio z `~/workspace/hapi` do `~/docker/hapi`.
- Jest to **środowisko docelowe**, w którym użytkownik sprawdza aktualny stan po każdej iteracji. Nie ma potwierdzonego osobnego środowiska testowego Huba i Runnera; nie opisuj sprawdzania na Serweuszu jako odizolowanego testu.
- Agent wykonuje dostępne lokalne sprawdzenia przed przekazaniem iteracji. Testy wymagające uruchomienia na Serweuszu wskazuje użytkownikowi jako oczekujące; nie deklaruje ich powodzenia bez rzeczywistych wyników.
- Opis tego przepływu nie jest zgodą na samodzielne kopiowanie, wdrażanie, uruchamianie Compose ani restartowanie usług przez agenta. Czynności na Serweuszu wykonuje użytkownik, chyba że wyraźnie zleci je agentowi.
- Pokazany skrypt nie synchronizuje ani nie zachowuje docelowego `data/`, `.env` lub lokalnego `.git`: usuwa je razem z katalogiem docelowym, po czym zastępuje stanem źródła. Przy montowaniu `./data:/home/node/.hapi` oznacza to możliwość utraty lub cofnięcia danych Huba. Nie traktuj pokazania skryptu jako zgody na jego uruchomienie przez agenta lub nadpisanie danych. Przed przygotowaniem zmiany wdrożenia ustal sposób zachowania aktualnych danych docelowych.
- `node_modules/`, `.tools/` i wygenerowane katalogi `dist/` są lokalnymi zależnościami oraz wynikami weryfikacji. Nie są potrzebne do budowania obrazu na Serweuszu. Reguły `.gitignore` i `.dockerignore` nie filtrują zwykłego kopiowania katalogu i nie chronią przy nim docelowego `data/` ani sekretów.

### Obowiązkowe komendy aktualizacji na końcu raportu

- **Po każdej iteracji wprowadzającej trwałe zmiany dołącz na samym końcu odpowiedzi dwa osobne bloki do wklejenia na Serweuszu: aktualizację kodu i `.git` Huba oraz opcjonalny push.** Dotyczy to również dokumentacji, konfiguracji i numeru wersji. Nie czekaj na osobną prośbę o te komendy.
- Blok aktualizacji ma kolejno: sprawdzić istnienie źródła, celu i wszystkich wskazanych plików **przed zatrzymaniem usług**; wykonać `docker compose down` w `~/docker/hapi`; skopiować/podmienić wyłącznie jawnie wskazane pliki z `~/workspace/hapi`, zachowując ścieżki względne; wykonać `docker compose up -d --build` w `~/docker/hapi`. Błąd dowolnego kroku ma zatrzymywać dalsze polecenia. Wskaż, że blok zatrzymuje Huba na czas aktualizacji i budowania.
- Stosuj `scripts/update-from-workspace.sh`: kopiuje kompletny zestaw plików wersjonowanych przez Git oraz samowystarczalne `.git` z zatwierdzonego workspace. Nie kopiuje ignorowanych danych, sekretów, zależności ani wyników budowania. Przed przekazaniem sprawdź listę plików i czystość repozytorium. Usunięcie pliku aplikacji uwzględniaj osobno i wyłącznie dla jawnie wskazanej ścieżki wynikającej z zadania; skrypt nie usuwa plików niewystępujących w źródłowym indeksie.
- Zachowuj docelowe `data/`, `.env`, pozostałe sekrety i lokalne ustawienia aplikacji. Przed podmianą docelowego `.git` przenieś je do kopii poza katalogiem projektu; następnie skopiuj `.git` z workspace. **Użytkownik polecił pominąć obecne commity na Serweuszu: nie importuj ich ani nie uzależniaj tego przepływu od ich synchronizacji.** Nie stosuj usuwania katalogu docelowego, `docker compose down -v` ani masowej synchronizacji z usuwaniem plików. Zmiany danych lub sekretów wymagają odrębnego wyraźnego zlecenia.
- Po ręcznym sprawdzeniu wersji użytkownik może wykonać osobny, opcjonalny `git push` z docelowego repozytorium. Commit jest już przygotowany w workspace i przeniesiony razem z `.git`. **Użytkownik wybiera termin publikacji; aktualizacja Huba i kolejne iteracje nie wymagają bieżącego pushowania.**
- Jeśli zakres wcześniejszych aktualizacji na Serweuszu nie jest potwierdzony, nie zakładaj, że wybiórcza lista odtworzy brakujące źródła. Podaj warunek wymaganego stanu lub ustal braki przed przygotowaniem zależnych poleceń. Nie oznaczaj tych komend jako wykonanych przez agenta; samo ich podanie nie upoważnia go do wdrożenia ani restartu.

## 4. Analiza przed implementacją

Najpierw zrozum istniejące rozwiązanie, później je zmieniaj.

Przed edycją kodu:

1. Przeczytaj odpowiednie fragmenty kodu i dokumentacji oraz zidentyfikuj odpowiedzialne komponenty i ich zależności.
2. Sprawdź, czy podobna funkcja lub mechanizm już istnieje w forku albo oryginalnym HAPI.
3. Wyznacz minimalny zakres zmian i rozważ alternatywy wykorzystujące istniejące rozwiązania.
4. Określ skutki uboczne, wpływ na inne komponenty, kompatybilność i przypadki brzegowe.
5. Dla większych zmian przedstaw w rozmowie plan implementacji i uzasadnienie decyzji technicznych przed rozpoczęciem implementacji.

Nie twórz nowego mechanizmu tylko dlatego, że łatwiej go napisać niż zrozumieć istniejący. Nie zapisuj planów ani specyfikacji prac na dysku; historia wykonanych zmian opisana w sekcji 8 nie jest planem.

## 5. Zmiany HAPI Runnera jako ostateczność

- Domyślnie szukaj rozwiązania w Hubie, frontendzie i istniejącej warstwie komunikacji.
- Przed zmianą Runnera przeanalizuj mechanizmy oryginalnego HAPI i sprawdź, czy wystarczy istniejące API bez modyfikowania Runnera.
- Jeżeli zmiana Runnera jest konieczna, **przed pierwszą edycją jego implementacji wyraźnie poinformuj użytkownika** i przedstaw:
  - konkretną przyczynę konieczności zmiany;
  - zakres planowanej ingerencji;
  - rozważone i odrzucone alternatywy wraz z powodami;
  - wpływ na kompatybilność z oryginalnym HAPI;
  - ryzyko dla działających sesji i komunikacji z Hubem.
- Nie wykonuj takich zmian po cichu. Każdą ingerencję w Runnera wyróżnij osobno w raporcie końcowym.

## 6. Kompatybilność z upstream

- Zachowuj możliwie największą zgodność z oryginalnym HAPI. Sam fakt pracy nad forkiem nie uzasadnia zmiany architektury.
- Preferuj rozszerzenia istniejącego kodu. Unikaj przepisywania działających mechanizmów i zastępowania kodu bazowego innym rozwiązaniem.
- Zachowuj istniejące API, formaty danych i protokoły komunikacji, chyba że zmiana jest konieczna do realizacji zadania.
- Unikaj niepowiązanych refaktoryzacji. Utrzymuj mały, czytelny zakres zmian ułatwiający scalanie przyszłych zmian upstream.
- Każdą konieczną niekompatybilność udokumentuj, uzasadnij i opisz jej konsekwencje dla dotkniętych komponentów.

## 7. Wersjonowanie przejęte z Prometheusa

Źródło: `/workspace/prometheus/AGENTS.md`, sekcje „Wersjonowanie” i „Historia wersji w docs”. Zachowuj poniższą logikę, a nie schemat SemVer przyjęty z przyzwyczajenia.

### Numer i moment zmiany wersji

- Początkowa wersja forka to **`v1.0`**, ustanawiana przy przygotowaniu pierwszej działającej kopii forka. Jest to reguła przejęta ze źródła, nie stwierdzenie obecnej wersji HAPI. Samo utworzenie `AGENTS.md` lub pustego `docs/` nie oznacza przygotowania działającego forka.
- Po ustanowieniu wersji początkowej każdy kolejny prompt, w ramach którego agent wprowadza trwałe zmiany w projekcie, wymaga podniesienia wersji **dokładnie raz o jeden**: `v1.0` → `v1.1` → `v1.2` itd. Po `v1.9` następuje **`v1.10`**, nie `v2.0`.
- Dotyczy to także konfiguracji, dokumentacji, tego pliku oraz dodawania i usuwania plików. Kilka edycji, testów i poprawek w ramach jednego promptu nie oznacza kilku wersji.
- Prompt wyłącznie do odczytu, analizy lub odpowiedzi, bez trwałych zmian w projekcie, nie podnosi wersji i nie tworzy wpisu historii.
- Aktualizacja numeru, jego prezentacji, README i historii jest częścią tego samego promptu; nie powoduje kolejnego podniesienia wersji.

### Źródło prawdy i zgodność prezentacji

- Zachowuj jedno źródło prawdy dla bieżącej wersji forka. Przed jej zmianą odnajdź i sprawdź rzeczywisty mechanizm wersji HAPI oraz dotychczasową historię wydań.
- Prometheus używa `APP_VERSION` w `src/constants.py`, z numerem bez prefiksu `v`. **Nie przenoś tej ścieżki ani zmiennej do HAPI**: są specyficzne dla aplikacji źródłowej, a w zastanej strukturze HAPI nie występują. Nie twórz fikcyjnego modułu Pythona ani arbitralnego zamiennika tylko po to, aby wskazać źródło wersji.
- Źródłem prawdy wersji forka jest `FORK_VERSION` w istniejącym module `shared/src/buildInfo.ts`, bez prefiksu `v`. Pierwsza implementacja ustanawia `1.0`; bieżący numer zawsze odczytuj z tego modułu. Zachowaj osobno upstreamowe `APP_VERSION` i wersje pakietów; nie zmieniaj nimi licznika forka ani odwrotnie.
- W kolejnej iteracji wykonaj `bun run version:bump` dokładnie raz w ramach zadania. Polecenie podnosi licznik i synchronizuje końcową stopkę angielskiego README. Przygotuj też odpowiadający wpis `docs/vN.M.md`. `bun run version:sync` oraz `bun run build:web` synchronizują README bez podnoszenia wersji; `bun run version:check` sprawdza zgodność. Wersja w lewym dolnym rogu UI pochodzi z tego samego `FORK_VERSION`. Pytania o postęp i kontynuacja rozpoczętego zadania nie oznaczają dodatkowego podniesienia.
- W Prometheusie wersja ma być widoczna na dole ustawień i zgodna z metadanymi API. W HAPI zachowaj wymóg zgodności wszystkich istniejących miejsc prezentacji wersji z ustalonym źródłem. Nie zakładaj istnienia takiego samego ekranu ustawień lub endpointu; ich konkretna lokalizacja jest specyficzna dla Prometheusa i wymaga sprawdzenia HAPI.
- Jeśli w głównym katalogu HAPI istnieje `README.md`, aktualizuj podaną w nim bieżącą wersję przy każdym podniesieniu. Stosuj tę zasadę również do README dodanego, zastąpionego lub skopiowanego z upstream później. Brak README nie jest poleceniem jego automatycznego utworzenia.

### Granice przejęcia zasad

- Nie przejmuj adresów, portów usług, kontenera `agy-workspace`, pośrednika terminalowego ani obowiązku zmiany nazw projektu bazowego właściwych dla Prometheusa. Opisują inną aplikację i infrastrukturę; dla HAPI obowiązuje architektura z sekcji 3 i zachowanie kompatybilności z upstream.
- Zasady numerowania i historii nie upoważniają do commitowania, tagowania, pushowania, publikowania wydania ani wdrożenia. Obowiązują ograniczenia z sekcji 9 i 10.
- **Historyczne ustanowienie tego dokumentu:** pierwotne zlecenie obejmowało wyłącznie przygotowanie `AGENTS.md`, więc wtedy nie ustanowiono wersji aplikacji ani plików historii. To historyczne ograniczenie nie dotyczy kolejnych zleceń implementacyjnych ani późniejszych zmian dokumentacji.

## 8. Historia wersji w `docs`

- Dla faktycznie ustanowionej wersji początkowej utwórz `docs/v1.0.md`. Dla każdego kolejnego podniesienia wersji twórz osobny plik, np. `docs/v1.1.md`, `docs/v1.2.md`.
- Każdy wpis ma podawać numer wersji, datę i rzeczywiste zmiany względem poprzedniej wersji: co dodano, zmieniono, usunięto lub naprawiono. Pomijaj puste kategorie.
- Wpis `v1.0` opisuje utworzenie działającego forka oraz jego różnice względem oryginalnego HAPI.
- Podawaj wyniki faktycznie wykonanej weryfikacji i jej ograniczenia. Nie przedstawiaj planów ani niewykonanych prac jako zmian ukończonych.
- Wszystkie wpisy historii przechowuj w `docs/`. Przy nowej wersji nie nadpisuj wcześniejszych wpisów.
- Aktualizację numeru, jego prezentacji i README oraz nowy wpis historii wykonuj łącznie w ramach jednego podniesienia wersji, z uwzględnieniem ograniczeń ustalenia źródła wersji z sekcji 7.

## 9. Ochrona środowiska produkcyjnego

Serweusz jest działającym serwerem, a nie jednorazowym środowiskiem testowym.

Bez wyraźnej zgody użytkownika nie wolno:

- wdrażać zmian na produkcję;
- restartować ani zatrzymywać działających usług i kontenerów;
- modyfikować systemowej konfiguracji Debiana ani konfiguracji Docker, Podman lub systemd;
- usuwać ani nadpisywać danych produkcyjnych;
- przeprowadzać migracji produkcyjnych danych lub konfiguracji.

Nie zakładaj dostępu do hosta na podstawie dostępu do kontenera programistycznego. Jeżeli zadanie wymaga zmian infrastrukturalnych, przedstaw wymagane czynności i ich konsekwencje. Lokalne sprawdzenia wykonuj bez wpływu na działające usługi i ich dane; nie traktuj zastanego `data/` jako danych testowych. Ręczne sprawdzanie iteracji przez użytkownika odbywa się w środowisku docelowym zgodnie z sekcją 3 i nie znosi ochrony produkcji.

## 10. Git i zakres zmian

- **Użytkownik zlecił agentowi utrzymywanie `.git` i tworzenie lokalnych commitów w `/workspace/hapi` po sprawdzeniu każdej iteracji.** Użytkownik kopiuje kod wraz z `.git` i sam decyduje o pushu z `~/docker/hapi`. To ustalenie zastępuje wcześniejszy zakaz commitowania w workspace i wymóg tworzenia commitów na Serweuszu.
- Przed rozpoczęciem pracy oraz przed dodaniem plików do commita sprawdź stan repozytorium, istniejące zmiany i diff. Inicjalizacja lokalnej historii nie oznacza odtworzenia historii upstream.
- Nie dodawaj do historii `data/`, baz danych, sekretów ani lokalnych plików `.env`. Utrzymuj odpowiednie wykluczenia w `.gitignore` i sprawdzaj faktyczną zawartość przygotowanego commita.
- Ustalony i potwierdzony autor to **`matiziompl <mateuszpolaski0@gmail.com>`**. Konfiguruj go wyłącznie lokalnie w repozytorium HAPI. Nie zmieniaj globalnej konfiguracji Git, nie wymyślaj innych danych i nie pytaj ponownie o potwierdzoną tożsamość w zwykłych iteracjach.
- Nie usuwaj ani nie nadpisuj wcześniejszych zmian użytkownika lub innych agentów.
- Bez wyraźnej zgody nie wykonuj operacji destrukcyjnych, takich jak `git reset --hard`, `git clean -fd` i wymuszone nadpisanie historii.
- Zgoda na prowadzenie lokalnej historii nie obejmuje tagowania, pushowania ani publikowania wydań. Wymagają one wyraźnego polecenia użytkownika i zgodności z zatwierdzonymi zasadami wersjonowania; samo podniesienie wersji nie jest taką zgodą.
- Nie modyfikuj niepowiązanych plików bez uzasadnienia. Utrzymuj zmiany czytelne, możliwie niewielkie, kontrolowalne i możliwe do bezpiecznego cofnięcia.

### Lokalne commity i opcjonalne publikowanie na GitHubie z Serweusza

- Docelowe repozytorium forka: [matiziompl/hapi-fork](https://github.com/matiziompl/hapi-fork), należące do użytkownika. Odróżniaj je od upstream `tiann/hapi` i historycznego źródła importu `matiziompl/hapi`.
- **Agent tworzy lokalne commity w workspace po weryfikacji; użytkownik sam obsługuje `gh` i wybiera termin wysłania tych commitów z `~/docker/hapi`.** Wcześniejsze niezatwierdzone iteracje można zebrać w pierwszym commicie forka, a kolejne iteracje zapisywać na bieżąco bez obowiązkowego pusha. Nie konfiguruj logowania do GitHuba ani nie przechowuj jego tokenów w kontenerze programistycznym.
- **Użytkownik jest już zalogowany do GitHuba przez `gh` na Serweuszu.** Traktuj uwierzytelnienie w tym środowisku jako przygotowane: nie wymagaj ponownego logowania ani nie dodawaj rutynowo `gh auth login` lub `gh auth status` do bloków publikacji. Wróć do sprawdzania uwierzytelnienia dopiero po rzeczywistym błędzie dostępu lub na wyraźną prośbę użytkownika. To ustalenie dotyczy Serweusza; nie oznacza zalogowania w kontenerze programistycznym ani potwierdzenia autora commitów, remote lub gałęzi repozytorium.
- **Po każdej iteracji podaj komendę kopiowania wersjonowanych źródeł i `.git` oraz osobny, opcjonalny push.** Lokalny commit ma już istnieć w workspace; nie przerzucaj na użytkownika ponownego `git add` ani `git commit` na Serweuszu.
- Przygotowanie lokalnego commita i aktualizacja Huba nie mogą wymagać dostępu do GitHuba, wcześniejszego pusha, `git fetch`/`git pull`, równości `HEAD` z `origin/main` ani wcześniejszego opublikowania wersji. Sprawdź zastany indeks i zachowaj niepowiązane przygotowane zmiany; nie czyść go automatycznie. Do przekazania `.git` wymagany jest zweryfikowany commit i czyste źródła; gdy niepowiązane zmiany to uniemożliwiają, zachowaj je i wyjaśnij ograniczenie.
- Przed pierwszym commitem sprawdź skumulowany zakres wcześniejszych iteracji, aby kompletny stan forka znalazł się w jego historii. Nie uzależniaj kontynuacji od istnienia wcześniejszych wpisów wersji w `HEAD`.
- Wskaż pliki do przeniesienia z workspace, katalog roboczy na Serweuszu (`~/docker/hapi` dla ustalonego przepływu), docelowe repozytorium `matiziompl/hapi-fork`, gałąź oraz wymagane przygotowanie Git i `gh`. Uwzględnij wyłącznie pliki objęte publikacją; nie używaj bezrefleksyjnie `git add .` ani nie kopiuj `data/` i sekretów.
- Komendy publikacji mają korzystać z `~/docker/hapi` i skopiowanej z workspace historii `.git`, bez osobnego przesyłania patcha i bez domyślnego tworzenia dodatkowego klonu. Preferuj krótkie polecenia wykorzystujące istniejące repozytorium. Osobny klon jest wariantem naprawczym tylko wtedy, gdy rzeczywisty stan repozytorium tego wymaga.
- Repozytorium w workspace ma `origin` ustawiony na `https://github.com/matiziompl/hapi-fork.git` i lokalną gałąź `main`. Historyczne źródło importu zachowano jako remote `import-source` (`https://github.com/matiziompl/hapi.git`). Nie zakładaj, że nowe repozytorium ma już gałąź `main` lub że skonfigurowano jej śledzenie; sprawdzaj aktualny stan przed publikacją. Konfiguracja nie zawiera danych logowania do GitHuba.
- Kopiuj historię razem z kodem dopiero po sprawdzeniu commita i wykluczeń danych. Zachowaj poprzednie docelowe `.git` w kopii poza projektem. **Nie wymagaj uzgadniania aktualnych commitów Serweusza — użytkownik wybrał historię workspace jako podstawę nowego repozytorium.**
- Przed kolejną iteracją sprawdź dostępną historię workspace i zdalnego repozytorium; uwzględniaj opublikowane zmiany bez utraty prac lokalnych. **Brak pusha nie blokuje kolejnej iteracji.** Nie nadpisuj zdalnej historii i nie zalecaj force-pusha. Historia źródłowa musi być kompletna i niezależna od zewnętrznych magazynów obiektów, aby skopiowane `.git` nadawało się do samodzielnego pusha.
- **Aktualizacja Huba, lokalny commit i publikacja na GitHubie to osobne czynności.** Wyraźnie opisz ich skutki. Brak dostępu do GitHuba nie może blokować kopiowania kodu, lokalnego commita ani przygotowania następnej iteracji.
- Dobieraj komendy do potwierdzonego stanu repozytorium. Uwzględnij przeniesienie lokalnych commitów na Serweusza oraz istniejącą historię na GitHubie; nie zakładaj, że `.git`, remote lub gałąź są już poprawnie przygotowane. Jeśli brakuje informacji, zapytaj zamiast podawać polecenia oparte na domysłach. Nie proponuj nadpisywania historii ani obchodzenia zabezpieczeń.
- Jeśli lokalna historia nie jest jeszcze połączona z repozytorium na GitHubie, przygotuj publikację na bazie jego istniejącej historii, np. w osobnym klonie z przeniesieniem wskazanych plików. Zachowaj pozostałe pliki repozytorium, w tym istniejące reguły `.gitignore`; nie zastępuj ich uproszczoną konfiguracją z kopii uruchomieniowej. Gdy brakuje uwierzytelnienia lub danych autora, podaj wymagane przygotowanie i zatrzymaj zależne kroki zamiast zgadywać wartości.
- Samo zasugerowanie publikacji i podanie komend nie upoważnia agenta do ich wykonania ani nie oznacza, że zmiany zostały wysłane. Nie łącz publikacji z automatycznym wdrożeniem lub restartem Huba.

## 11. Testowanie i weryfikacja

- Po zmianach uruchom odpowiednie dostępne testy i, jeśli dotyczy, sprawdzenie kompilacji lub budowania. Sam zapis kodu nie potwierdza poprawności zadania.
- Zweryfikuj zgodność z architekturą, wpływ na inne komponenty, przypadki brzegowe i zachowanie dotychczasowej funkcjonalności.
- Dobieraj polecenia do rzeczywistego stosu i dostępnych narzędzi. Nie zakładaj obecności testów, menedżera pakietów ani skryptów budowania bez sprawdzenia.
- Zgodnie z nadrzędnymi zasadami workspace nie uruchamiaj Playwrighta, Chromium ani testów przeglądarkowych. Testy API wykonuj w pamięci, a frontend buduj tylko po zmianach kodu UI. Nie zapętlaj instalacji zależności.
- Przy zmianie wyłącznie dokumentacji sprawdź jej kompletność, spójność, zgodność ze źródłami i zakres zmienionych plików; nie uruchamiaj niepowiązanego buildu aplikacji.
- Nie deklaruj testów, których nie wykonano. Podawaj rzeczywiste wyniki, także niepowodzenia. Jeśli weryfikacja jest niemożliwa, wskaż przyczynę i elementy wymagające późniejszego sprawdzenia.
- Oddzielaj własne sprawdzenia lokalne od testów użytkownika na Serweuszu. Samo przygotowanie plików do skopiowania nie potwierdza działania w środowisku docelowym.
- Nigdy nie uruchamiaj weryfikacji naruszającej ochronę `hapi_original` lub środowiska produkcyjnego.

## 12. Rzetelność i jakość procesu

Poprawność sposobu wykonania jest równie ważna jak rezultat. Poprawność techniczna ma pierwszeństwo przed pozornym ukończeniem zadania.

- Opieraj decyzje na rzeczywistym kodzie, dokumentacji i wynikach poleceń. Rozróżniaj fakty, przypuszczenia i nieweryfikowane hipotezy.
- Nie wymyślaj API, funkcji, zachowań bibliotek, integracji ani wyników testów. Nie dopasowuj faktów do wcześniej wybranego rozwiązania.
- Nie zastępuj wymaganych funkcji atrapami lub komunikatami o sukcesie bez rzeczywistego wykonania operacji. Nie usuwaj wymagań, aby ukryć trudność lub uzyskać pozornie poprawne testy.
- Sygnalizuj niezgodności, błędne założenia i problemy. Otwarcie opisuj brak informacji, niewykonalność oraz konieczne kompromisy.
- Gdy wymagania są sprzeczne z możliwościami technicznymi, wskaż sprzeczność i zaproponuj uzasadnione alternatywy.
- Preferuj prostotę, czytelność i utrzymywalność. Nie dodawaj niepotrzebnych abstrakcji ani funkcji poza zakresem zadania.

### Brakujące informacje i pytania do użytkownika

- **Śmiało pytaj użytkownika, gdy potrzebujesz informacji. Pytanie jest lepsze niż niezweryfikowane założenie.** Dotyczy to szczególnie środowiska, dostępu, konfiguracji, architektury i oczekiwanego działania.
- Ograniczaj wnioskowanie o nieudokumentowanych faktach do minimum. Sprawdź dostępny kod, dokumentację i wcześniejsze ustalenia; jeśli nie dają odpowiedzi lub są sprzeczne, zapytaj zamiast uzupełniać luki domysłami. Nie przedstawiaj hipotezy jako ustalenia.
- Pytaj konkretnie: wskaż, jakiej informacji brakuje i do jakiej decyzji jest potrzebna. Łącz powiązane pytania i nie proś ponownie o informacje już przekazane lub możliwe do jednoznacznego sprawdzenia.
- Jeżeli brak odpowiedzi wpływa na poprawność, zakres zmian, bezpieczeństwo danych lub zgodność z architekturą, wstrzymaj zależną część pracy do uzyskania wyjaśnienia. Możesz kontynuować niezależne, bezpieczne czynności. Brak odpowiedzi nie oznacza potwierdzenia założenia ani udzielenia zgody.

**Halucynowanie rozwiązania w celu wykazania wykonania zadania nie jest wykonaniem zadania.**

## 13. Raport końcowy

Po zadaniu przedstaw zwięzły, konkretny raport obejmujący:

1. **Wprowadzone zmiany** — co rzeczywiście zmodyfikowano.
2. **Uzasadnienie** — dlaczego wybrano to rozwiązanie.
3. **Zakres ingerencji** — które komponenty i pliki objęto zmianą.
4. **Testy** — wykonane sprawdzenia i ich rzeczywiste wyniki.
5. **Kompatybilność** — wpływ na upstream i pozostałe komponenty.
6. **Ograniczenia** — czego nie wykonano lub nie zweryfikowano i dlaczego.
7. **Ryzyka** — problemy wymagające uwagi; jeśli ich nie zidentyfikowano, zaznacz zakres tej oceny.

Na samym końcu raportu po zadaniu wprowadzającym trwałe zmiany dołącz **dwa osobne bloki komend do wklejenia na Serweuszu**: zatrzymanie Huba, kopiowanie wersjonowanych źródeł wraz z `.git` i ponowne budowanie według sekcji 3, a następnie opcjonalny push Git według sekcji 10, wykonywany dopiero po ręcznej weryfikacji wersji. Agent ma wcześniej utworzyć lokalny commit w workspace i podać jego identyfikator. Samo wskazanie plików, sam Git albo samo Docker Compose nie wystarcza.

**HAPI Runner:** osobno wyróżnij każdą jego modyfikację wraz z wpływem i ryzykiem. Jeśli go nie zmieniano, podaj to wprost. Nie raportuj sukcesu bez wystarczających podstaw.
