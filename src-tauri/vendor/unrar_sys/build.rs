fn main() {
    println!("cargo:rerun-if-changed=vendor/unrar");
    println!("cargo:rerun-if-changed=compass_layout.cpp");
    if cfg!(windows) {
        println!("cargo:rustc-flags=-lpowrprof");
        println!("cargo:rustc-link-lib=shell32");
        println!("cargo:rustc-link-lib=advapi32");
        if cfg!(target_env = "gnu") {
            println!("cargo:rustc-link-lib=pthread");
        }
    } else {
        println!("cargo:rustc-link-lib=pthread");
    }
    link_compiler_rt_on_intel_mac();
    let files: Vec<String> = [
        "strlist",
        "strfn",
        "pathfn",
        "smallfn",
        "global",
        "file",
        "filefn",
        "filcreat",
        "archive",
        "arcread",
        "unicode",
        "system",
        #[cfg(windows)]
        "isnt",
        "crypt",
        "crc",
        "rawread",
        "encname",
        "match",
        "timefn",
        "rdwrfn",
        "consio",
        "options",
        "errhnd",
        "rarvm",
        "secpassword",
        "rijndael",
        "getbits",
        "sha1",
        "sha256",
        "blake2s",
        "hash",
        "extinfo",
        "extract",
        "volume",
        "list",
        "find",
        "unpack",
        "headers",
        "threadpool",
        "rs16",
        "cmddata",
        "ui",
        "filestr",
        "scantree",
        "dll",
        "qopen",
        // rar.hpp only declares MarkOfTheWeb under PROPAGATE_MOTW, and the Zone.Identifier
        // stream it reads is an NTFS feature, so this unit has nothing to compile elsewhere.
        #[cfg(windows)]
        "motw",
        "largepage",
    ].iter().map(|&s| format!("vendor/unrar/{s}.cpp")).collect();
    cc::Build::new()
        .cpp(true) // Switch to C++ library compilation.
        .opt_level(2)
        .std("c++14")
        // by default cc crate tries to link against dynamic stdlib, which causes problems on windows-gnu target
        .cpp_link_stdlib(None)
        .warnings(false)
        .extra_warnings(false)
        .flag_if_supported("-stdlib=libc++")
        .flag_if_supported("-fPIC")
        .flag_if_supported("-Wno-switch")
        .flag_if_supported("-Wno-parentheses")
        .flag_if_supported("-Wno-macro-redefined")
        .flag_if_supported("-Wno-dangling-else")
        .flag_if_supported("-Wno-logical-op-parentheses")
        .flag_if_supported("-Wno-unused-parameter")
        .flag_if_supported("-Wno-unused-variable")
        .flag_if_supported("-Wno-unused-function")
        .flag_if_supported("-Wno-missing-braces")
        .flag_if_supported("-Wno-unknown-pragmas")
        .flag_if_supported("-Wno-deprecated-declarations")
        .define("_FILE_OFFSET_BITS", Some("64"))
        .define("_LARGEFILE_SOURCE", None)
        // Keep archive decoding on one CPU; no UnRAR worker pool.
        .define("RARDLL", None)
        .files(&files)
        .file("compass_layout.cpp")
        .compile("libunrar.a");
}

// UnRAR's x86 SIMD probes use __builtin_cpu_supports, which clang resolves through ___cpu_model in
// compiler-rt. rustc links Apple targets with -nodefaultlibs, so libclang_rt.osx.a is never pulled
// in and x86_64-apple-darwin fails to link. Linux gets the symbol from libgcc, Windows uses __cpuid,
// and arm64 has no SSE probes.
fn link_compiler_rt_on_intel_mac() {
    if std::env::var("TARGET").as_deref() != Ok("x86_64-apple-darwin") {
        return;
    }
    let compiler = cc::Build::new().cpp(true).get_compiler();
    let output = std::process::Command::new(compiler.path())
        .arg("--print-resource-dir")
        .output()
        .expect("run the C++ compiler to locate compiler-rt");
    let resource_dir = String::from_utf8(output.stdout).expect("compiler resource dir is UTF-8");
    let darwin = std::path::Path::new(resource_dir.trim())
        .join("lib")
        .join("darwin");
    if !darwin.join("libclang_rt.osx.a").exists() {
        panic!("no libclang_rt.osx.a under {}; UnRAR needs it for ___cpu_model", darwin.display());
    }
    println!("cargo:rustc-link-search=native={}", darwin.display());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}
